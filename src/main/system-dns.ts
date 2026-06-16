import { exec } from "node:child_process";
import { promisify } from "node:util";

/**
 * Cross-platform system DNS configuration.
 *
 * macOS: uses `networksetup` (no admin elevation needed for DNS changes on
 * the active network service).
 *
 * Windows: uses `netsh interface ipv4 set dnsservers` (requires admin —
 * the NSIS installer requests `requireAdministrator` so the elevated app
 * can run these commands without a separate UAC prompt per change).
 *
 * Linux: uses `resolvectl` (systemd-resolved). Best-effort only.
 */

const execAsync = promisify(exec);

export interface DnsSnapshot {
  platform: "macos" | "windows" | "linux";
  service: string; // network service name / interface alias
  servers: string[]; // previous DNS servers (empty array means "automatic / DHCP")
}

async function macActiveService(): Promise<string> {
  // Pick the first network service that has an active interface and IP.
  const { stdout } = await execAsync(`/usr/sbin/networksetup -listallnetworkservices`);
  const services = stdout
    .split("\n")
    .slice(1)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("*"));
  // Prefer Wi-Fi if present
  const wifi = services.find((s) => /wi[- ]?fi/i.test(s));
  if (wifi) return wifi;
  return services[0] ?? "Wi-Fi";
}

async function winActiveAdapter(): Promise<string> {
  // PowerShell: get active adapter sorted by interface metric.
  const ps = `powershell.exe -NoProfile -Command "(Get-NetIPInterface -AddressFamily IPv4 | Where-Object { $_.ConnectionState -eq 'Connected' -and $_.InterfaceAlias -notlike 'Loopback*' } | Sort-Object InterfaceMetric | Select-Object -First 1).InterfaceAlias"`;
  const { stdout } = await execAsync(ps);
  const adapter = stdout.trim();
  if (!adapter) throw new Error("No active network adapter found");
  return adapter;
}

export async function snapshotSystemDns(): Promise<DnsSnapshot> {
  if (process.platform === "darwin") {
    const svc = await macActiveService();
    const { stdout } = await execAsync(`/usr/sbin/networksetup -getdnsservers ${JSON.stringify(svc)}`);
    const lines = stdout.trim().split("\n");
    // If unset, networksetup prints "There aren't any DNS Servers set on …"
    const servers = lines[0].includes("aren't any") ? [] : lines.map((l) => l.trim());
    return { platform: "macos", service: svc, servers };
  }
  if (process.platform === "win32") {
    const adapter = await winActiveAdapter();
    const ps = `powershell.exe -NoProfile -Command "(Get-DnsClientServerAddress -InterfaceAlias '${adapter.replace(/'/g, "''")}' -AddressFamily IPv4).ServerAddresses -join ','"`;
    const { stdout } = await execAsync(ps);
    const servers = stdout.trim() ? stdout.trim().split(",").map((s) => s.trim()).filter(Boolean) : [];
    return { platform: "windows", service: adapter, servers };
  }
  return { platform: "linux", service: "default", servers: [] };
}

export async function applySystemDns(servers: string[]): Promise<void> {
  if (process.platform === "darwin") {
    const svc = await macActiveService();
    const list = servers.join(" ");
    await execAsync(`/usr/sbin/networksetup -setdnsservers ${JSON.stringify(svc)} ${list}`);
    return;
  }
  if (process.platform === "win32") {
    const adapter = await winActiveAdapter();
    const list = servers.map((s) => `'${s}'`).join(",");
    const ps = `powershell.exe -NoProfile -Command "Set-DnsClientServerAddress -InterfaceAlias '${adapter.replace(/'/g, "''")}' -ServerAddresses ${list}"`;
    await execAsync(ps);
    return;
  }
  if (process.platform === "linux") {
    const list = servers.join(" ");
    await execAsync(`resolvectl dns $(resolvectl status | grep -m1 'Link [0-9]' | awk '{print $3}' | tr -d '()') ${list}`).catch(() => {});
  }
}

export async function restoreSystemDns(snap: DnsSnapshot): Promise<void> {
  if (snap.platform === "macos") {
    const arg = snap.servers.length === 0 ? "empty" : snap.servers.join(" ");
    await execAsync(`/usr/sbin/networksetup -setdnsservers ${JSON.stringify(snap.service)} ${arg}`);
    return;
  }
  if (snap.platform === "windows") {
    if (snap.servers.length === 0) {
      // Reset to DHCP
      const ps = `powershell.exe -NoProfile -Command "Set-DnsClientServerAddress -InterfaceAlias '${snap.service.replace(/'/g, "''")}' -ResetServerAddresses"`;
      await execAsync(ps);
    } else {
      const list = snap.servers.map((s) => `'${s}'`).join(",");
      const ps = `powershell.exe -NoProfile -Command "Set-DnsClientServerAddress -InterfaceAlias '${snap.service.replace(/'/g, "''")}' -ServerAddresses ${list}"`;
      await execAsync(ps);
    }
    return;
  }
  // linux: best-effort
  if (snap.servers.length > 0) {
    await applySystemDns(snap.servers).catch(() => {});
  }
}
