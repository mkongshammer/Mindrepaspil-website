import { contextBridge, ipcRenderer } from "electron";

const api = {
  device: {
    id: () => ipcRenderer.invoke("device:id") as Promise<string>,
    platform: () => ipcRenderer.invoke("device:platform") as Promise<"macos" | "windows" | "linux">,
    hostname: () => ipcRenderer.invoke("device:hostname") as Promise<string>,
    appVersion: () => ipcRenderer.invoke("device:appVersion") as Promise<string>,
  },
  api: {
    register: () => ipcRenderer.invoke("api:register"),
    status: () =>
      ipcRenderer.invoke("api:status") as Promise<{
        subscription: { active: boolean; source: string | null; status: string | null };
        // FREE model: paired desktop installs are entitled via `isLinked`, not a
        // paid subscription. Renderer uses this to decide linked-vs-gate.
        isLinked?: boolean;
        partner?: { name: string; email?: string; phone?: string } | null;
      }>,
    requestUninstall: () => ipcRenderer.invoke("api:requestUninstall"),
    confirmUninstall: (code: string) => ipcRenderer.invoke("api:confirmUninstall", code),
    pairWithCode: (code: string, displayName?: string) =>
      ipcRenderer.invoke("api:pairWithCode", { code, displayName }) as Promise<{
        ok: boolean;
        canonicalUserId?: string;
        alreadyLinked?: boolean;
        error?: string;
      }>,
    openExternal: (url: string) =>
      ipcRenderer.invoke("system:openExternal", url) as Promise<void>,
  },
  protection: {
    check: () =>
      ipcRenderer.invoke("protection:check") as Promise<{ active: boolean }>,
    installProfile: () =>
      ipcRenderer.invoke("protection:installProfile") as Promise<{ ok: boolean }>,
  },
};

contextBridge.exposeInMainWorld("betoff", api);
export type BetOffApi = typeof api;
