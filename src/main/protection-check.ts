import { Resolver } from "node:dns/promises";

const TEST_BLOCKED_DOMAIN = "bet365.com";

/**
 * Probe whether macOS is actually routing DNS through the Mindre På Spil blocker.
 *
 * We do NOT bind a local resolver any more (that was the bug that killed
 * the user's internet). Instead, after the user installs our DoH
 * configuration profile via System Settings, every DNS query on the Mac
 * goes through our cloud DoH endpoint — which returns NXDOMAIN for any
 * gambling domain on the static blocklist + AI classifier.
 *
 * So we can detect "is protection on?" by simply asking the OS to resolve
 * a known-blocked domain. If the OS DNS is the Mindre På Spil blocker, this
 * fails with ENOTFOUND. If it's the user's normal router/ISP DNS, it
 * resolves to real bet365.com IPs.
 */
/**
 * Tri-state DNS probe that feeds the heartbeat's `dnsActive` signal:
 *   true  → protection ON  (a known-blocked domain failed to resolve)
 *   false → protection OFF (the domain resolved to real public IPs)
 *   null  → INCONCLUSIVE   (timeout / network down) — never report this as
 *           "off", or a brief outage would falsely alert the partner. The
 *           server COALESCEs null to the previous stored value.
 */
export async function probeDnsState(): Promise<boolean | null> {
  // Use a fresh Resolver so we always hit the *current* system DNS
  // settings, not anything Node may have cached.
  const resolver = new Resolver();
  try {
    const addrs = await Promise.race([
      resolver.resolve4(TEST_BLOCKED_DOMAIN),
      new Promise<string[]>((_r, rej) =>
        setTimeout(() => rej(new Error("dns-timeout")), 4000),
      ),
    ]);
    // If we got real-looking public IPs back, system DNS is NOT going
    // through the blocker. Treat 0.0.0.0 / 127.x as "blocked" too in case
    // we ever switch the server to return sinkhole IPs instead of NXDOMAIN.
    const looksReal = addrs.some(
      (ip) => !ip.startsWith("0.") && !ip.startsWith("127."),
    );
    return !looksReal;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? "";
    // ENOTFOUND / NXDOMAIN / NODATA all mean "blocker said no" → active.
    if (code === "ENOTFOUND" || code === "NOTFOUND" || code === "NODATA") {
      return true;
    }
    // Network down, timeout, etc — INCONCLUSIVE. Don't claim on or off.
    return null;
  }
}

/**
 * Boolean view for the tray/UI: only a definite `true` counts as "protected".
 * An inconclusive probe is treated as not-protected so the UI nudges the user
 * to (re)install the profile rather than falsely claiming protection.
 */
export async function isProtectionActive(): Promise<boolean> {
  return (await probeDnsState()) === true;
}
