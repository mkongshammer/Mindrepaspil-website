import { useEffect, useRef, useState } from "react";

interface DeviceInfo {
  hostname?: string;
  platform?: string;
  appVersion?: string;
}

export function Status({
  onUninstallRequest,
}: {
  onUninstallRequest: () => void;
}) {
  const [info, setInfo] = useState<DeviceInfo>({});
  const [protectionActive, setProtectionActive] = useState<boolean | null>(null);
  const [opening, setOpening] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    void (async () => {
      const [platform, hostname, version] = await Promise.all([
        window.betoff.device.platform(),
        window.betoff.device.hostname(),
        window.betoff.device.appVersion(),
      ]);
      setInfo({ platform, hostname, appVersion: version });
    })();
  }, []);

  // Probe protection on mount, then re-probe every 4s while OFF (user is
  // likely installing the profile right now). Slow to 30s once active.
  useEffect(() => {
    let cancelled = false;
    async function probe() {
      try {
        const r = await window.betoff.protection.check();
        if (!cancelled) setProtectionActive(r.active);
      } catch {
        if (!cancelled) setProtectionActive(false);
      }
    }
    void probe();
    const intervalMs = protectionActive ? 30_000 : 4_000;
    pollTimer.current = setInterval(probe, intervalMs);
    return () => {
      cancelled = true;
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
  }, [protectionActive]);

  async function handleInstall() {
    setOpening(true);
    try {
      await window.betoff.protection.installProfile();
    } finally {
      setTimeout(() => setOpening(false), 1500);
    }
  }

  const showOn = protectionActive === true;
  const showOff = protectionActive === false;

  return (
    <div>
      <div className={`status-hero ${showOn ? "" : "off"}`}>
        <div className="shield-icon">
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke={showOn ? "#10b981" : "#f43f5e"}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
        </div>
        <div className="status-headline">
          {showOn
            ? "Protection ON"
            : showOff
            ? "Protection OFF"
            : "Checking…"}
        </div>
        <div className="status-sub">
          {showOn
            ? "Every gambling site is blocked on this Mac, in every browser and app."
            : showOff
            ? "Install the protection profile to start blocking on this Mac."
            : "Verifying your network…"}
        </div>
      </div>

      {showOff && (
        <div className="card">
          <h2 style={{ color: "white", marginTop: 0 }}>
            One more step — install the protection profile
          </h2>
          <p style={{ marginBottom: 8 }}>
            macOS needs a small <strong style={{ color: "white" }}>configuration profile</strong> so
            every browser and app on this Mac uses the Mindre På Spil blocker. You only
            do this once.
          </p>
          <ol
            style={{
              color: "var(--text-dim)",
              paddingLeft: 18,
              margin: "8px 0 12px",
              lineHeight: 1.6,
            }}
          >
            <li>Click the button below — your browser downloads the profile.</li>
            <li>
              Open <strong style={{ color: "white" }}>System Settings →
              Privacy &amp; Security → Profiles</strong>.
            </li>
            <li>
              Double-click <strong style={{ color: "white" }}>Mindre På Spil DNS Filter</strong> →
              Install. Type your Mac password.
            </li>
            <li>Done — this screen will switch to green automatically.</li>
          </ol>

          <button
            className="btn btn-block"
            onClick={handleInstall}
            disabled={opening}
            style={{ marginTop: 4 }}
          >
            {opening ? "Opening…" : "Install protection profile"}
          </button>
        </div>
      )}

      {showOn && (
        <div className="card">
          <h2 style={{ color: "white", marginTop: 0 }}>How it works</h2>
          <p style={{ marginBottom: 6 }}>
            Every DNS request from this Mac goes through the Mindre På Spil cloud
            blocker — same 261-domain blocklist + AI classifier as the mobile
            app. New gambling sites are caught the first time anyone tries them.
          </p>
          <p className="muted" style={{ marginBottom: 0 }}>
            Your accountability partner (set on your phone) is notified if
            this Mac goes offline or the profile is removed.
          </p>
        </div>
      )}

      <div className="card">
        <h2 style={{ color: "white", marginTop: 0 }}>Device</h2>
        <p style={{ marginBottom: 4 }}>
          <strong style={{ color: "white" }}>{info.hostname ?? "—"}</strong> ·{" "}
          {info.platform}
        </p>
        <p className="muted" style={{ margin: 0 }}>
          Mindre På Spil v{info.appVersion}
        </p>
      </div>

      <hr />

      <button className="btn btn-ghost btn-block" onClick={onUninstallRequest}>
        Request to uninstall
      </button>
      <p className="muted" style={{ marginTop: 8, textAlign: "center" }}>
        Your accountability partner will be sent a 6-digit code.
        You&apos;ll need them to enter it.
      </p>
    </div>
  );
}
