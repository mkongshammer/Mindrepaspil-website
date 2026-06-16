# Bet Off Desktop — Build Guide for Freelancers

This document is a step-by-step build guide for producing the signed and
notarized installers for the Bet Off desktop app. Everything is already
written and tested — your job is to build, sign, and notarize on real
Mac and Windows machines.

**Estimated time:** 2 hours per platform on a well-prepared machine.

---

## What you're producing

| Platform | File | Size estimate |
|---|---|---|
| macOS | `Bet Off-1.0.0-universal.dmg` | ~150 MB |
| Windows | `Bet Off Setup 1.0.0.exe` | ~80 MB |

Output goes to `artifacts/desktop/release/` after the build.

---

## Prerequisites — both platforms

1. **Node.js 20+ and pnpm 10+**
   - Mac: `brew install node@24 pnpm` OR install Node from https://nodejs.org/ then `corepack enable pnpm`
   - Windows: install Node from https://nodejs.org/ then `corepack enable pnpm`

2. **The repository** — clone it or get the project zip from Magnus.

3. **Initial install (one-time, ~5 min):**
   ```bash
   cd <repo-root>
   pnpm install
   ```

4. **Verify the build works unsigned first** (sanity check before signing):
   ```bash
   pnpm --filter @workspace/desktop run build
   ```
   This produces `artifacts/desktop/dist/renderer/` and `artifacts/desktop/dist/main/`. Should finish in under 30 seconds with no errors. **If this step fails, stop and contact Magnus — don't try to fix it yourself.**

---

## macOS build

### Required Apple credentials

Magnus has these — ask him for them in this exact format:

| Credential | What it looks like |
|---|---|
| Apple ID email | `magnus@example.com` |
| App-specific password | `abcd-efgh-ijkl-mnop` (generated at https://appleid.apple.com → Sign-In and Security → App-Specific Passwords) |
| Team ID | 10-character code like `ABCDE12345` (find at https://developer.apple.com/account → Membership) |

### Required certificates (already on your Mac if you've shipped Mac apps before)

You need a **"Developer ID Application"** certificate in your Keychain. To install:
- Open Xcode → Settings → Accounts → sign in with Magnus's Apple ID (or your own with access to his team)
- Select the team → Manage Certificates → `+` → "Developer ID Application"

Verify with:
```bash
security find-identity -v -p codesigning
```
You should see a line like `1) ABC123... "Developer ID Application: Magnus Kongshammer (ABCDE12345)"`.

### Build command

```bash
export APPLE_ID="magnus@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="abcd-efgh-ijkl-mnop"
export APPLE_TEAM_ID="ABCDE12345"

pnpm --filter @workspace/desktop run dist:mac
```

This will:
1. Compile the renderer (Vite) and main process (TypeScript)
2. Bundle into a `.app`
3. Code-sign with the Developer ID cert
4. Upload to Apple's notary service (5–15 min wait — let it run, do not Ctrl+C)
5. Staple the notarization ticket
6. Produce `artifacts/desktop/release/Bet Off-1.0.0-universal.dmg`

### Verifying the build

```bash
# Check the .dmg is signed and notarized:
spctl --assess --type install "artifacts/desktop/release/Bet Off-1.0.0-universal.dmg"
# Should print: "accepted"

# Mount and check the .app inside:
hdiutil attach "artifacts/desktop/release/Bet Off-1.0.0-universal.dmg"
codesign --verify --deep --strict --verbose=2 "/Volumes/Bet Off 1.0.0/Bet Off.app"
# Should print: "valid on disk" and "satisfies its Designated Requirement"
hdiutil detach "/Volumes/Bet Off 1.0.0"
```

### Smoke test on the Mac before delivery

1. Double-click the `.dmg`, drag Bet Off to Applications, eject the disk image.
2. Open Bet Off from Applications. **No Gatekeeper warning should appear** — if it does, notarization failed. Re-check the build logs.
3. Click through Welcome → Setup. Add yourself as the accountability partner (your own email/phone).
4. Click "Turn on protection". macOS will ask for your password (this is the DNS change — expected).
5. Open Safari and try to visit `https://bet365.com` → should fail with a DNS error.
6. Open Safari and try to visit `https://google.com` → should load normally.
7. Click "Request to uninstall". You should receive a 6-digit code at your own email/phone within 30 seconds.
8. Type the code in the app → app should restore your DNS and quit.
9. Verify your DNS is restored: System Settings → Network → Wi-Fi → Details → DNS — should be back to the original servers (probably your router's IP or `192.168.x.1`).

If any step fails, send Magnus a screenshot + the contents of `~/Library/Logs/Bet Off/` (if it exists) and the Terminal output of `pnpm dist:mac`.

---

## Windows build

### Code signing — this is an SSL.com EV cert (cloud / eSigner), NOT a .pfx

Magnus has an **SSL.com EV Code Signing certificate**. Since June 2023, EV (and all
public) code-signing keys **cannot be exported as a `.pfx` file** — the private key
lives in SSL.com's cloud HSM and is used via **eSigner** (CSC protocol). The old
"drop a `.pfx` at `build/win-cert.pfx`" approach does **NOT** work for this cert.

Why this matters: EV signing gives the installer **instant Windows SmartScreen
trust** — there is no "reputation warming" period. An **unsigned** build (which is
the current state — there is no signing wired into `electron-builder.yml`) is exactly
what triggers *"Windows protected your PC / unrecognized app"*.

There are two ways to apply the signature.

#### Option A — eSigner Express (web, no build pipeline) ← easiest

Signs an already-built `.exe`. No Java, no config, no code edits.

1. Build the unsigned installer:
   ```powershell
   pnpm --filter @workspace/desktop run dist:win
   ```
   → produces `artifacts\desktop\release\Bet Off Setup 1.0.0.exe`
2. One-time: in Magnus's SSL.com account, set the eSigner **PIN** and **issue the
   signing credential** (see the order email, or
   https://www.ssl.com/guide/remote-ev-code-signing-with-esigner/).
3. Go to https://express.esigner.com, sign in, and **drag the `.exe` onto the page**.
   It signs and returns a signed `.exe`.
4. The signed file is what ships — send it to Magnus to upload (it replaces the
   download served at `/api/downloads/windows`).

#### Option B — CodeSignTool (automated, for CI / repeat builds)

Use SSL.com's CodeSignTool (Java CLI) so each `dist:win` signs automatically.
Credentials (ask Magnus — set as env vars, **never commit**):

| Env var | From |
|---|---|
| `ES_USERNAME` | SSL.com account email |
| `ES_PASSWORD` | SSL.com account password |
| `ES_CREDENTIAL_ID` | eSigner credential ID (SSL.com dashboard) |
| `ES_TOTP_SECRET` | eSigner TOTP / automation secret |

Sign in place after building:
```bash
CodeSignTool sign -username="$ES_USERNAME" -password="$ES_PASSWORD" \
  -credential_id="$ES_CREDENTIAL_ID" -totp_secret="$ES_TOTP_SECRET" \
  -input_file_path="artifacts/desktop/release/Bet Off Setup 1.0.0.exe" -override
```
(This can also be wired into `electron-builder.yml` as a custom `win.sign` hook —
ask Magnus / the agent to set it up.)

### Verifying the Windows build

```powershell
Get-AuthenticodeSignature "artifacts\desktop\release\Bet Off Setup 1.0.0.exe"
# Status: Valid
# StatusMessage: Signature verified.
```

### Smoke test on Windows before delivery

1. Run the installer. Click "Yes" on the UAC prompt.
2. It's a one-click installer — there is NO folder picker or Next button. It installs to Program Files and launches Bet Off automatically when done.
3. Bet Off launches automatically. Walk through Welcome → Setup with yourself as partner.
4. Click "Turn on protection" — UAC will prompt again (DNS change). Click Yes.
5. Open Edge or Chrome → try `https://bet365.com` (should fail) and `https://google.com` (should work).
6. Request uninstall, receive the code on your phone/email, type it in.
7. Verify DNS restored: `Get-DnsClientServerAddress` should NOT show `127.0.0.1`.

---

## Delivery checklist

Send Magnus:

- [ ] `Bet Off-1.0.0-universal.dmg` (Mac) and/or `Bet Off Setup 1.0.0.exe` (Win)
- [ ] The output of `spctl --assess` (Mac) or `Get-AuthenticodeSignature` (Win) showing valid signing
- [ ] A short Loom video (or screenshots) of you doing the smoke test on a clean machine

**Do NOT** zip the .dmg or .exe — send them as-is via WeTransfer / Dropbox / Google Drive (file size is too large for email).

---

## Common problems and fixes

### Mac: "Notarization failed: invalid credentials"
- Re-generate the app-specific password at https://appleid.apple.com — they expire silently.
- Confirm the Team ID matches what's on https://developer.apple.com/account → Membership.

### Mac: "The application can't be opened" after install
- Notarization didn't complete. Re-run `pnpm dist:mac` and watch for `notarize` step in the logs — it should say "Notarization succeeded".

### Windows: "SmartScreen prevented an unrecognized app from starting"
- This happens with non-EV certs for the first ~30 days / 3000 downloads. Either buy an EV cert OR tell users to click "More info" → "Run anyway".

### Both: build fails with "Cannot find module"
- Run `pnpm install` again at the repo root. Don't run it inside `artifacts/desktop/`.

### Both: build fails before signing with TypeScript errors
- Run `pnpm --filter @workspace/desktop run build` and send Magnus the full output. **Do not** edit any `.ts` file — that's not what we're paying you for.

---

## What you should NOT do

- Do not modify any `.ts`, `.tsx`, or `.json` source files — only `electron-builder.yml` for cert paths.
- Do not bump dependency versions.
- Do not change the app icon, name, version number, or bundle ID.
- Do not commit anything to git unless Magnus asks.
- Do not upload the installers anywhere public — send them privately to Magnus.

---

## Questions?

Ping Magnus directly. Don't try to "fix" things yourself — the project is in a known-working state and any "improvements" risk breaking the production-ready build.
