import { useEffect, useState } from "react";

type Phase = "confirm" | "sending" | "code-entry" | "verifying" | "done" | "error";

export function Uninstall({ onCancel }: { onCancel: () => void }) {
  const [phase, setPhase] = useState<Phase>("confirm");
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [sentMessage, setSentMessage] = useState<string | null>(null);

  async function handleRequest() {
    setError(null);
    setPhase("sending");
    try {
      const r = await window.betoff.api.requestUninstall();
      if (!r.ok) throw new Error("Could not send code to partner");
      setSentMessage(r.message);
      setPhase("code-entry");
    } catch (err) {
      setError((err as Error).message);
      setPhase("error");
    }
  }

  async function handleSubmitCode() {
    setError(null);
    if (code.replace(/\D/g, "").length !== 6) {
      setError("Code must be 6 digits.");
      return;
    }
    setPhase("verifying");
    try {
      const r = await window.betoff.api.confirmUninstall(code.replace(/\D/g, ""));
      if (!r.ok) throw new Error(r.error ?? "Incorrect code");
      setPhase("done");
    } catch (err) {
      setError((err as Error).message);
      setPhase("code-entry");
    }
  }

  if (phase === "confirm") {
    return (
      <div>
        <h1>Are you sure?</h1>
        <p>
          To uninstall, your accountability partner must enter a 6-digit code.
          We will send the code only to them — never to you.
        </p>
        <div className="banner warn">
          The code is sent by email <strong>and</strong> SMS to your partner.
          If you don't agree it should be uninstalled, just close this window.
        </div>
        <button className="btn btn-danger btn-block" onClick={handleRequest}>
          Send code to my partner
        </button>
        <button className="btn btn-ghost btn-block" onClick={onCancel} style={{ marginTop: 8 }}>
          Never mind, keep protecting me
        </button>
      </div>
    );
  }

  if (phase === "sending") {
    return (
      <div>
        <h1>Sending code…</h1>
        <p>Notifying your accountability partner.</p>
      </div>
    );
  }

  if (phase === "code-entry" || phase === "verifying") {
    return (
      <div>
        <h1>Have your partner enter the code.</h1>
        <p>{sentMessage}</p>
        <div className="banner warn">
          Best practice: hand the keyboard to your partner. Don't ask them to read the
          code aloud — they should type it themselves so you never see it.
        </div>
        <CodeEntry value={code} onChange={setCode} disabled={phase === "verifying"} />
        {error && <div className="banner error" style={{ marginTop: 12 }}>{error}</div>}
        <button
          className="btn btn-danger btn-block"
          onClick={handleSubmitCode}
          disabled={phase === "verifying"}
          style={{ marginTop: 16 }}
        >
          {phase === "verifying" ? "Verifying…" : "Confirm uninstall"}
        </button>
        <button className="btn btn-ghost btn-block" onClick={onCancel} style={{ marginTop: 8 }}>
          Cancel — keep protection on
        </button>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div>
        <h1>Something went wrong</h1>
        <div className="banner error">{error}</div>
        <button className="btn btn-block" onClick={() => setPhase("confirm")}>
          Try again
        </button>
        <button className="btn btn-ghost btn-block" onClick={onCancel} style={{ marginTop: 8 }}>
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div>
      <h1>Protection has been turned off.</h1>
      <p>The app will close in a moment. You can now drag it to the Trash (Mac) or use Add/Remove Programs (Windows) to fully remove it.</p>
      <p>Your accountability partner has been notified.</p>
    </div>
  );
}

function CodeEntry({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  useEffect(() => {
    // Auto-focus the input when this view mounts so the partner can type immediately.
    const el = document.getElementById("uninstall-code-input") as HTMLInputElement | null;
    el?.focus();
  }, []);
  return (
    <input
      id="uninstall-code-input"
      className="code-input"
      inputMode="numeric"
      maxLength={6}
      placeholder="••••••"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
    />
  );
}
