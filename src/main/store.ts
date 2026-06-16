import { app } from "electron";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { DnsSnapshot } from "./system-dns";

export interface PersistentStore {
  protectionWasActive?: boolean;
  partnerConfigured?: boolean;
  dnsSnapshot?: DnsSnapshot;
}

async function storePath(): Promise<string> {
  return path.join(app.getPath("userData"), "store.json");
}

export async function loadStore(): Promise<PersistentStore> {
  try {
    const raw = await fs.readFile(await storePath(), "utf8");
    return JSON.parse(raw) as PersistentStore;
  } catch {
    return {};
  }
}

export async function saveStore(s: PersistentStore): Promise<void> {
  const file = await storePath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(s, null, 2), "utf8");
}
