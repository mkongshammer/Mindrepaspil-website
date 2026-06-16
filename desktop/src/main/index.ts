import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell } from "electron";
import * as path from "node:path";
import * as os from "node:os";
import { restoreSystemDns, snapshotSystemDns } from "./system-dns";
import { startHeartbeat, stopHeartbeat } from "./heartbeat";
import { getOrCreateDeviceId } from "./device";
import { loadStore, saveStore } from "./store";
import { isProtectionActive } from "./protection-check";
import * as api from "./api";

const isDev = !app.isPackaged;
const RENDERER_DEV_URL = "http://localhost:5180";
const RENDERER_PROD_FILE = path.join(__dirname, "../renderer/index.html");
const API_BASE = process.env.BET_OFF_API_BASE ?? "https://www.mindrepaaspil.dk/api";
const PROFILE_URL = `${API_BASE}/dns-profile.mobileconfig`;

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let cachedProtectionActive = false;

function platformId(): "macos" | "windows" | "linux" {
  if (process.platform === "darwin") return "macos";
  if (process.platform === "win32") return "windows";
  return "linux";
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 720,
    minWidth: 420,
    minHeight: 600,
    backgroundColor: "#0a0a0c",
    title: "Mindre På Spil",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    show: false,
  });

  if (isDev) {
    await mainWindow.loadURL(RENDERER_DEV_URL);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    await mainWindow.loadFile(RENDERER_PROD_FILE);
  }

  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("close", (e) => {
    if (!(global as any).__quitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });
}

function createTray(): void {
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, "tray.png")
    : path.join(__dirname, "../../build/tray.png");
  let icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  refreshTray();
}

function refreshTray(): void {
  if (!tray) return;
  tray.setToolTip(
    cachedProtectionActive
      ? "Mindre På Spil — protection ON"
      : "Mindre På Spil — protection OFF",
  );
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: cachedProtectionActive
          ? "✅ Protection: ON"
          : "⚠️ Protection: OFF",
        enabled: false,
      },
      { type: "separator" },
      { label: "Open Mindre På Spil", click: () => mainWindow?.show() },
      {
        label: "Open website",
        click: () => shell.openExternal("https://www.mindrepaaspil.dk"),
      },
    ]),
  );
}

/**
 * SAFETY NET for users who installed an earlier broken build that pointed
 * macOS DNS at 127.0.0.1 (the old build tried to run a local DNS proxy on
 * port 53; the bind failed with EACCES, leaving the system with a dead
 * DNS server and zero internet). On every launch we check the current DNS
 * setting — if it is *only* 127.0.0.1, we revert to DHCP / previous
 * servers so the user gets their internet back automatically.
 */
async function healBrokenDnsFromOldBuild(): Promise<void> {
  try {
    const current = await snapshotSystemDns();
    const stuck =
      current.servers.length > 0 &&
      current.servers.every((s) => s === "127.0.0.1" || s === "::1");
    if (!stuck) return;

    const store = await loadStore();
    if (store.dnsSnapshot && store.dnsSnapshot.servers[0] !== "127.0.0.1") {
      console.warn("Self-heal: restoring DNS from previous snapshot");
      await restoreSystemDns(store.dnsSnapshot);
    } else {
      console.warn("Self-heal: clearing stuck 127.0.0.1 DNS, reverting to DHCP");
      await restoreSystemDns({
        platform: current.platform,
        service: current.service,
        servers: [],
      });
    }
  } catch (err) {
    console.warn("Self-heal DNS check failed:", (err as Error).message);
  }
}

// IPC handlers
ipcMain.handle("device:id", () => getOrCreateDeviceId());
ipcMain.handle("device:platform", () => platformId());
ipcMain.handle("device:hostname", () => os.hostname());
ipcMain.handle("device:appVersion", () => app.getVersion());

ipcMain.handle("api:register", async () => {
  const id = await getOrCreateDeviceId();
  return api.register({
    deviceId: id,
    platform: platformId(),
    appVersion: app.getVersion(),
    hostname: os.hostname(),
  });
});

ipcMain.handle("api:status", async () => {
  const id = await getOrCreateDeviceId();
  return api.status(id);
});

ipcMain.handle("api:requestUninstall", async () => {
  const id = await getOrCreateDeviceId();
  return api.requestUninstall(id);
});

ipcMain.handle("api:confirmUninstall", async (_e, code: string) => {
  const id = await getOrCreateDeviceId();
  const r = await api.confirmUninstall(id, code);
  if (r.ok) {
    stopHeartbeat();
    setTimeout(() => {
      (global as any).__quitting = true;
      app.quit();
    }, 1500);
  }
  return r;
});

ipcMain.handle("api:pairWithCode", async (
  _e,
  args: { code: string; displayName?: string },
) => {
  try {
    const id = await getOrCreateDeviceId();
    const r = await api.pairWithCode({
      code: args.code,
      deviceId: id,
      platform: platformId(),
      displayName: args.displayName ?? os.hostname(),
    });
    startHeartbeat(id);
    return { ok: true, canonicalUserId: r.canonicalUserId, alreadyLinked: r.alreadyLinked };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
});

ipcMain.handle("protection:check", async () => {
  const active = await isProtectionActive();
  if (active !== cachedProtectionActive) {
    cachedProtectionActive = active;
    refreshTray();
  }
  return { active };
});

ipcMain.handle("protection:installProfile", async () => {
  // Opens the .mobileconfig URL in the user's browser. macOS downloads
  // it; the user then opens System Settings → Privacy & Security →
  // Profiles → "Mindre På Spil DNS Filter" → Install. One admin password,
  // then DoH-based blocking is on across every browser and app, even
  // when the Mindre På Spil app is closed.
  await shell.openExternal(PROFILE_URL);
  return { ok: true };
});

ipcMain.handle("system:openExternal", async (_e, url: string) => {
  if (typeof url !== "string") return;
  if (!/^https?:\/\//i.test(url)) return;
  await shell.openExternal(url);
});

app.whenReady().then(async () => {
  // Headless mode invoked by the Windows NSIS uninstaller hook BEFORE files
  // are removed: report the uninstall so the backend alerts the accountability
  // partner, then exit. No window, tray, or heartbeat.
  if (process.argv.includes("--report-uninstall")) {
    try {
      await api.reportUninstall(
        await getOrCreateDeviceId(),
        "desktop-uninstaller",
      );
    } catch (err) {
      console.warn("report-uninstall failed:", (err as Error).message);
    }
    (global as any).__quitting = true;
    app.quit();
    return;
  }

  // Run safety-net BEFORE creating the window so the user never sees the
  // app load offline if their DNS was stuck on 127.0.0.1.
  await healBrokenDnsFromOldBuild();

  await createWindow();
  createTray();

  // Initial protection probe so the tray icon is correct from launch.
  isProtectionActive().then((active) => {
    cachedProtectionActive = active;
    refreshTray();
  }).catch(() => {});

  // Resume heartbeats if we're already paired.
  try {
    const status = await api.status(await getOrCreateDeviceId());
    // FREE model: resume heartbeats for any PAIRED install (isLinked), not just
    // paid subscriptions. The heartbeat carries the dnsActive tamper signal, so
    // it must run for every linked device across restarts.
    if (status?.isLinked || status?.subscription?.active) {
      startHeartbeat(await getOrCreateDeviceId());
    }
  } catch {
    /* offline at boot — heartbeat will start after pairing */
  }

  // Clear any leftover snapshot from the old build now that we've healed.
  const store = await loadStore();
  if (store.dnsSnapshot || store.protectionWasActive) {
    await saveStore({ ...store, dnsSnapshot: undefined, protectionWasActive: false });
  }
});

app.on("before-quit", (e) => {
  if (!(global as any).__quitting) {
    e.preventDefault();
    mainWindow?.hide();
  }
});

app.on("window-all-closed", () => {
  // Keep the app alive in tray
});
