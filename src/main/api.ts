/**
 * HTTP client wrapper for the Mindre På Spil API server. All endpoints exist
 * under <domain>/api/desktop/* — see artifacts/api-server/src/routes/desktop.ts.
 */

const API_BASE = process.env.BET_OFF_API_BASE ?? "https://www.mindrepaaspil.dk/api";

async function jsonPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    let parsed: { error?: string } = {};
    try {
      parsed = JSON.parse(txt) as { error?: string };
    } catch {
      // not JSON
    }
    throw new Error(parsed.error ?? `HTTP ${res.status}: ${txt.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

async function jsonGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

export interface Device {
  deviceId: string;
  userId: string;
  platform: string;
  status: string;
  installedAt: string;
  lastHeartbeatAt: string;
  atRisk: boolean;
  uninstallPending: boolean;
}

export interface SubscriptionState {
  active: boolean;
  source: "apple" | "google" | "stripe" | null;
  status: string | null;
  expiresAt: string | null;
}

export function register(args: {
  deviceId: string;
  platform: "macos" | "windows" | "linux";
  appVersion: string;
  hostname: string;
}): Promise<{ device: Device; created: boolean }> {
  return jsonPost("/desktop/register", args);
}

export function heartbeat(
  deviceId: string,
  dnsActive?: boolean | null,
): Promise<{ device: Device }> {
  // `dnsActive` lets the backend alert the partner on a TRUE->FALSE transition
  // (DNS blocker turned off). Pass null/undefined when inconclusive — the
  // server COALESCEs it to the previous value so a brief outage can't alarm.
  return jsonPost("/desktop/heartbeat", { deviceId, dnsActive });
}

export function status(
  deviceId: string,
): Promise<{
  device: Device;
  subscription: SubscriptionState;
  canonicalUserId: string;
  isLinked: boolean;
}> {
  return jsonGet(`/desktop/status?deviceId=${encodeURIComponent(deviceId)}`);
}

export function dnsBackup(deviceId: string, backup: unknown): Promise<{ ok: boolean }> {
  return jsonPost("/desktop/dns-backup", { deviceId, backup });
}

export function requestUninstall(deviceId: string): Promise<{ ok: boolean; message: string }> {
  return jsonPost("/desktop/request-uninstall", { deviceId });
}

/**
 * Report that this install is being force-uninstalled (no partner code).
 * Called from the OS uninstaller hook BEFORE files are removed so the backend
 * can alert the accountability partner that protection was removed.
 */
export function reportUninstall(
  deviceId: string,
  reason?: string,
): Promise<{ ok: boolean }> {
  return jsonPost("/desktop/report-uninstall", { deviceId, reason });
}

export function confirmUninstall(
  deviceId: string,
  code: string,
): Promise<{ ok: boolean; error?: string; dnsBackup?: string }> {
  return jsonPost("/desktop/confirm-uninstall", { deviceId, code });
}

export function savePartner(
  deviceId: string,
  partner: { name: string; email?: string; phone?: string },
): Promise<{ ok: boolean }> {
  return jsonPost("/desktop/partner", { deviceId, ...partner });
}

/**
 * Pair this desktop install into an existing Mindre På Spil account (mobile-first
 * subscriber types in a 6-digit code from their iPhone). On success the
 * server links our deviceId to their canonical userId and our subsequent
 * /desktop/status calls will return `subscription.active: true`.
 */
export function pairWithCode(args: {
  code: string;
  deviceId: string;
  platform: "macos" | "windows" | "linux";
  displayName?: string;
}): Promise<{ ok: boolean; canonicalUserId: string; alreadyLinked: boolean }> {
  return jsonPost("/pair/complete", {
    code: args.code,
    deviceId: args.deviceId,
    deviceKind: "desktop",
    platform: args.platform,
    displayName: args.displayName,
  });
}

/**
 * Issue a 6-digit pairing code FROM this desktop install so a mobile user
 * (who doesn't yet have their own subscription) can join this account.
 * Mirror of the mobile-first flow but in the opposite direction. Only works
 * when the desktop install actually has an active subscription.
 */
export function startPairCodeFromDesktop(
  deviceId: string,
): Promise<{ code: string; expiresAt: string; ttlSeconds: number }> {
  return jsonPost("/pair/start", {
    originDeviceId: deviceId,
    originDeviceKind: "desktop",
  });
}

/**
 * Open Stripe Checkout for a brand-new desktop-first user. The API returns a
 * Stripe-hosted checkout URL — the renderer opens it in the system browser
 * via `shell.openExternal`. On completion the user comes back to the app
 * and we poll /desktop/status until subscription.active flips true.
 */
export function startDesktopCheckout(
  userId: string,
): Promise<{ url: string }> {
  return jsonPost("/stripe/checkout", { userId });
}
