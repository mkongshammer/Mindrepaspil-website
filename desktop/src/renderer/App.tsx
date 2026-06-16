import { useEffect, useState } from "react";
import { Status } from "./screens/Status";
import { Uninstall } from "./screens/Uninstall";
import { Pair } from "./screens/Pair";

type Screen = "loading" | "gate" | "pair" | "linked" | "uninstall";

export function App() {
  const [screen, setScreen] = useState<Screen>("loading");
  const [deviceLabel, setDeviceLabel] = useState("computer");

  async function refresh(): Promise<void> {
    try {
      await window.betoff.api.register();
      const statusResp = (await window.betoff.api.status()) as {
        subscription?: { active: boolean };
        isLinked?: boolean;
      };
      // FREE model: a desktop install is "linked" once paired to a mobile
      // account (isLinked), NOT gated on a paid subscription. Keep the legacy
      // subscription.active as a fallback for any paid/legacy account.
      const linked = !!statusResp?.isLinked || !!statusResp?.subscription?.active;
      setScreen(linked ? "linked" : "gate");
    } catch (err) {
      console.error("init failed", err);
      setScreen("gate");
    }
  }

  useEffect(() => {
    void refresh();
    void window.betoff.device
      .platform()
      .then((p) =>
        setDeviceLabel(p === "macos" ? "Mac" : p === "windows" ? "PC" : "computer"),
      )
      .catch(() => {});
  }, []);

  return (
    <div className="app">
      <div className="titlebar" />
      <div className="content">
        <div className="brand">
          <div className="brand-mark">M</div>
          <span>Mindre På Spil</span>
        </div>

        {screen === "loading" && <p>Loading…</p>}

        {screen === "gate" && (
          <div>
            <h1>Welcome to Mindre På Spil for {deviceLabel}.</h1>
            <p>
              Block gambling sites on this computer using the same protection
              already running on your phone.
            </p>

            <div
              className="card"
              style={{
                background: "rgba(16, 185, 129, 0.08)",
                border: "1px solid rgba(16, 185, 129, 0.3)",
                marginTop: 16,
              }}
            >
              <h2 style={{ color: "#10b981", marginTop: 0 }}>
                You need the Mindre På Spil mobile app
              </h2>
              <p style={{ marginBottom: 0 }}>
                The computer version is <strong style={{ color: "white" }}>free</strong> with
                your mobile subscription. Install Mindre På Spil on your iPhone or
                Android first, then link this {deviceLabel} in two taps.
              </p>
            </div>

            <button
              className="btn btn-block"
              onClick={() => setScreen("pair")}
              style={{ marginTop: 16 }}
            >
              I have the mobile app — link this {deviceLabel}
            </button>

            <p className="muted" style={{ marginTop: 16, textAlign: "center" }}>
              Don&apos;t have it yet? Search <strong>&quot;Mindre På Spil&quot;</strong> in
              the App Store or Google Play, then come back here.
            </p>
          </div>
        )}

        {screen === "pair" && (
          <Pair
            onBack={() => setScreen("gate")}
            onPaired={() => {
              void refresh();
            }}
          />
        )}

        {screen === "linked" && (
          <Status onUninstallRequest={() => setScreen("uninstall")} />
        )}

        {screen === "uninstall" && (
          <Uninstall onCancel={() => setScreen("linked")} />
        )}
      </div>
    </div>
  );
}
