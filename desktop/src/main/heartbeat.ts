import * as api from "./api";
import { probeDnsState } from "./protection-check";

const HEARTBEAT_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes
let timer: NodeJS.Timeout | null = null;

export function startHeartbeat(deviceId: string): void {
  stopHeartbeat();
  // Fire one immediately so the server knows we're up
  void tick(deviceId);
  timer = setInterval(() => void tick(deviceId), HEARTBEAT_INTERVAL_MS);
}

export function stopHeartbeat(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

async function tick(deviceId: string): Promise<void> {
  try {
    // Include the live DNS-blocker state so the backend can alert the partner
    // the moment protection is turned off. null (inconclusive) is sent as-is;
    // the server keeps the prior value rather than firing a false alarm.
    const dnsActive = await probeDnsState();
    await api.heartbeat(deviceId, dnsActive);
  } catch (err) {
    // Best-effort. Server will mark device at-risk after ~6 min of silence
    // and notify the partner.
    console.warn("heartbeat failed:", (err as Error).message);
  }
}
