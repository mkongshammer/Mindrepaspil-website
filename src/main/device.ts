import * as crypto from "node:crypto";
import { app } from "electron";
import * as fs from "node:fs/promises";
import * as path from "node:path";

/**
 * Stable per-install device ID. Stored in the app's userData directory so it
 * survives across app launches. Not in OS keychain (would require extra
 * native deps); userData is durable enough for v1 — uninstalling the app
 * deletes it, which is the desired tamper signal anyway.
 */

let cached: string | null = null;

async function deviceFilePath(): Promise<string> {
  return path.join(app.getPath("userData"), "device-id.txt");
}

export async function getOrCreateDeviceId(): Promise<string> {
  if (cached) return cached;
  const file = await deviceFilePath();
  try {
    const existing = (await fs.readFile(file, "utf8")).trim();
    if (existing && existing.length >= 8) {
      cached = existing;
      return existing;
    }
  } catch {
    // not present
  }
  const fresh = crypto.randomUUID();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, fresh, "utf8");
  cached = fresh;
  return fresh;
}
