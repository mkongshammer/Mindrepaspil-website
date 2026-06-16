# Bet Off — Desktop App

Cross-platform (macOS + Windows) desktop blocker for gambling sites.
Companion to the Bet Off mobile app — uses the same AI classifier, the same
261-domain blocklist, the same accountability-partner notifications, and the
same backend at `https://www.betoff.io/api`.

## How it works

1. On install, the app generates a stable device ID stored in the OS user data
   directory and registers it with the API server (`POST /api/desktop/register`).
2. The user adds an accountability partner (name + email and/or phone).
3. When protection is activated:
   - A local UDP DNS proxy starts on `127.0.0.1:53` (`src/main/dns-proxy.ts`)
     that forwards every DNS query as DNS-over-HTTPS to
     `https://www.betoff.io/api/dns-query`.
   - The system DNS is pointed at `127.0.0.1` using `networksetup` (macOS) /
     `Set-DnsClientServerAddress` (Windows). The previous DNS settings are
     snapshotted and stored server-side so they can be restored on uninstall.
   - Every browser and app on the computer now goes through the Bet Off
     blocker. Gambling domains return NXDOMAIN; safe domains are forwarded to
     Cloudflare (this happens server-side).
4. The app pings `POST /api/desktop/heartbeat` every 2 minutes. If the server
   doesn't hear from the device for ~6 minutes, the partner is alerted.
5. To uninstall, the user clicks "Request to uninstall". The server generates
   a 6-digit code and sends it ONLY to the partner (email + SMS). The code
   is never displayed in the app. The partner has to type it in (or read it
   to the user). Confirming the code restores the original DNS settings,
   notifies the partner, and quits the app.

## Repository layout

```
artifacts/desktop/
├── src/
│   ├── main/           # Electron main process (Node)
│   │   ├── index.ts        — app lifecycle, tray, IPC handlers
│   │   ├── dns-proxy.ts    — local UDP→DoH bridge (127.0.0.1:53)
│   │   ├── system-dns.ts   — platform-specific DNS configuration
│   │   ├── heartbeat.ts    — 2-minute API ping
│   │   ├── api.ts          — HTTP client for /api/desktop/*
│   │   ├── device.ts       — persistent device ID
│   │   └── store.ts        — small JSON config store
│   ├── preload/        # contextBridge between main + renderer
│   │   ├── index.ts
│   │   └── types.d.ts
│   └── renderer/       # React UI (Vite)
│       ├── main.tsx
│       ├── App.tsx
│       ├── styles.css
│       └── screens/
│           ├── Welcome.tsx
│           ├── Setup.tsx
│           ├── Status.tsx
│           └── Uninstall.tsx
├── electron-builder.yml    — packaging config (DMG + NSIS)
├── package.json
├── tsconfig.main.json      — main process TS config (CommonJS)
├── tsconfig.renderer.json  — renderer TS config (ESM bundler)
└── vite.config.ts          — renderer dev/build config
```

## Server endpoints used

All defined in `artifacts/api-server/src/routes/desktop.ts`:

- `POST /api/desktop/register`          — first launch / re-launch
- `POST /api/desktop/heartbeat`         — every 2 minutes while running
- `GET  /api/desktop/status`            — pull current device state
- `POST /api/desktop/dns-backup`        — stash pre-install DNS settings
- `POST /api/desktop/request-uninstall` — generate code, fire to partner
- `POST /api/desktop/confirm-uninstall` — validate code, mark disabled

The DNS resolution itself uses the existing `POST /api/dns-query` endpoint
that the mobile app's iOS/Android profiles already use.

## Database

A new table `desktop_protection` (in `lib/db/src/schema/desktop.ts`) tracks
per-install state: device id, platform, hostname, status, last heartbeat,
DNS backup, uninstall code, and timestamps. Run a migration with
`pnpm --filter @workspace/db run push` after pulling.

## Local development

```bash
pnpm install
# Terminal 1 — renderer (Vite at localhost:5180)
pnpm --filter @workspace/desktop run dev
# Terminal 2 — Electron main, watches the renderer
pnpm --filter @workspace/desktop run dev:electron
```

The dev electron run uses `BET_OFF_API_BASE` env to point at production by
default. To point at your local API server: `BET_OFF_API_BASE=http://localhost:80/api`.

## Building installers

**Replit cannot build the final installers.** Code signing requires:

- **macOS:** an Apple Developer ID Application certificate, plus notarization
  via `notarytool`. Build on a Mac (or a Mac CI like GitHub Actions
  `macos-latest`).
- **Windows:** a code-signing certificate (EV recommended for SmartScreen
  reputation). Build on Windows or via cross-compile on Linux with `wine`.

### macOS build

```bash
# On a Mac with the cert installed in the keychain:
pnpm install
pnpm --filter @workspace/desktop run dist:mac
# Output: artifacts/desktop/release/Bet Off-1.0.0.dmg (universal x64+arm64)
```

For notarization, set these env vars before `dist:mac`:
```bash
export APPLE_ID="you@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="abcd-efgh-ijkl-mnop"
export APPLE_TEAM_ID="ABCDE12345"
```

### Windows build

```powershell
# On a Windows machine:
pnpm install
pnpm --filter @workspace/desktop run dist:win
# Output: artifacts\desktop\release\Bet Off Setup 1.0.0.exe
```

For code signing, Bet Off uses an **SSL.com EV Code Signing certificate**. EV keys
live in SSL.com's cloud HSM and **cannot be exported as a `.pfx`** — sign via eSigner
(drag the built `.exe` onto https://express.esigner.com) or SSL.com CodeSignTool. EV
gives instant SmartScreen trust; an unsigned `.exe` is what Windows blocks. Full steps
in `BUILD-FOR-FREELANCER.md` → "Windows build".

## Hosting the downloads

After building, upload the `.dmg` and `.exe` somewhere publicly downloadable:
- Replit Object Storage (`@workspace/object-storage`)
- A simple static bucket (S3, R2, etc.)
- GitHub Releases

Then update the URLs in `artifacts/website/src/pages/download.tsx` (the
two `href="#"` placeholders).

## Tamper resistance — v1 limits

This is the **soft lock** described in our planning conversation. It is real
and useful, but a determined user with admin access could bypass it by:

- Manually changing system DNS back via the OS settings panel
- Killing the Electron process from Activity Monitor / Task Manager
- Re-installing the OS

To partially defeat each of these in v2:
- Run as a system service / LaunchDaemon that auto-restarts and re-applies
  DNS every minute
- On macOS: install a configuration profile that locks DNS settings
- On Windows: install a NetworkExtension-equivalent or use a WFP (Windows
  Filtering Platform) driver

For v1, the **accountability layer is the real teeth**: the moment any of
those bypass attempts happens, the heartbeat stops within 6 minutes and the
partner is notified. Tampering is detected, even if not prevented.

## Security model — v1

**Authentication is "knowledge-of-deviceId equals proof".** The deviceId is a
random UUID generated on first launch and stored in the OS user-data
directory; it never leaves the local machine except over HTTPS to our API.
All `/api/desktop/*` endpoints accept the deviceId as the only credential.

This is the same trust model that already ships in production for
`/api/stripe/checkout` and `/api/stripe/payment-sheet` on mobile (see
`replit.md` → "Account deletion"). It is *tamper-evident, not
tamper-proof*: if an attacker can read the file at
`~/Library/Application Support/Bet Off/device-id.txt` (Mac) or
`%APPDATA%/Bet Off/device-id.txt` (Windows), they could change the
accountability partner and uninstall. The `userData` directory is
per-user-account on both OSes, so cross-user attacks require either local
access to the same OS account or a privilege escalation.

For v2, harden by either:
1. Issuing a bearer token on `/register` (HMAC-signed with `DEVICE_TOKEN_SECRET`,
   matching mobile's `requireDevice` middleware), and store it in OS keychain
   via `keytar` instead of plaintext userData.
2. Or require a second factor (partner email confirmation) before any
   `PUT /api/desktop/partner` call that *changes* the partner.

## Self-healing DNS on startup

If the desktop app crashes or is force-quit while protection is active,
the system DNS stays pointed at `127.0.0.1`. Without our local DNS proxy
running, the OS gets no DNS replies and the user loses internet access.

`src/main/index.ts` mitigates this on every launch: if `protectionWasActive`
is false in the persistent store but the current system DNS is `127.0.0.1`,
the previous snapshot is automatically restored. This recovers from crashes
and orphaned-state scenarios.

It does **not** cover the case where the user drags the .app to Trash without
going through the in-app uninstall flow. In that case:
- macOS: ship a `Bet Off Uninstaller.app` alongside the main app that
  restores DNS and removes user data — and tell users in the README on the
  download page to use it instead of dragging.
- Windows: the NSIS uninstaller (auto-generated by electron-builder) runs
  before files are deleted; add an `nsis.include` script that calls the
  app with a `--restore-dns` flag, or run a small native helper that reads
  the persisted snapshot and applies it.

## Known v1 gaps

- The `/api/partner/desktop-set` endpoint referenced by `api.ts` is a
  placeholder — current mobile partner endpoint requires a bearer device
  token. Either (a) add a new `desktop-set` endpoint that uses deviceId
  knowledge as proof (matching how `/api/desktop/register` works), or (b)
  issue a desktop bearer token at register time and use the existing
  `/api/partner` PUT.
- App icons (`build/tray.png`, `build/icon.icns`, `build/icon.ico`) are not
  included — operator must generate from a 1024×1024 source PNG using
  `electron-icon-builder` or similar.
- No auto-update flow yet (electron-updater can be wired up later).
- Linux is best-effort — works in development but not packaged in `dist:mac` /
  `dist:win`. To add later: `target: AppImage` in electron-builder.yml.
