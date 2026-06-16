import * as dgram from "node:dgram";
import * as dnsPacket from "dns-packet";

/**
 * Local DNS proxy on 127.0.0.1:53 (UDP).
 *
 * Receives standard UDP DNS queries from the OS, forwards them to the Mindre
 * På Spil DNS-over-HTTPS endpoint, and returns the binary response. The DoH endpoint
 * does ALL the gambling-blocking work — this proxy is just the adapter that
 * lets a desktop OS (which speaks UDP DNS, not DoH) talk to it.
 */

const DOH_URL = "https://www.mindrepaaspil.dk/api/dns-query";

let server: dgram.Socket | null = null;

async function forwardToDoh(query: Buffer): Promise<Buffer> {
  const res = await fetch(DOH_URL, {
    method: "POST",
    headers: {
      "content-type": "application/dns-message",
      "accept": "application/dns-message",
    },
    body: query,
    signal: AbortSignal.timeout(3000),
  });
  if (!res.ok) {
    throw new Error(`DoH HTTP ${res.status}`);
  }
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

function buildServfail(query: Buffer): Buffer {
  // Decode the question, return SERVFAIL so the resolver gives up cleanly.
  try {
    const decoded = dnsPacket.decode(query);
    return dnsPacket.encode({
      type: "response",
      id: decoded.id,
      flags: dnsPacket.RECURSION_DESIRED | dnsPacket.RECURSION_AVAILABLE | 2 /* SERVFAIL */,
      questions: decoded.questions,
      answers: [],
    });
  } catch {
    return Buffer.alloc(0);
  }
}

export function startDnsProxy(): Promise<void> {
  if (server) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server = dgram.createSocket("udp4");

    server.on("message", async (msg, rinfo) => {
      try {
        const reply = await forwardToDoh(msg);
        server?.send(reply, rinfo.port, rinfo.address);
      } catch (err) {
        console.warn("DoH forward failed:", (err as Error).message);
        const failReply = buildServfail(msg);
        if (failReply.length > 0) {
          server?.send(failReply, rinfo.port, rinfo.address);
        }
      }
    });

    server.on("error", (err) => {
      console.error("DNS proxy error:", err);
    });

    // Bind to 127.0.0.1:53 only — never expose externally
    server.bind(53, "127.0.0.1", () => resolve());
    server.once("error", reject);
  });
}

export function stopDnsProxy(): Promise<void> {
  return new Promise((resolve) => {
    if (!server) return resolve();
    server.close(() => {
      server = null;
      resolve();
    });
  });
}
