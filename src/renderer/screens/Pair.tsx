import { useEffect, useState } from "react";

/**
 * Pair-an-existing-account screen.
 *
 * The user opens the mobile app → Settings → Link a computer → "Generate
 * code", reads off a 6-digit code, and types it here. On success the
 * desktop install is bound to their existing canonical account and the
 * subscription they already pay for covers this computer too.
 */
export function Pair({
  onPaired,
  onBack,
}: {
  onPaired: () => void;
  onBack: () => void;
}) {
  const [digits, setDigits] = useState<string[]>(["", "", "", "", "", ""]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setDigit(i: number, v: string) {
    const clean = v.replace(/\D/g, "").slice(-1);
    setDigits((prev) => {
      const copy = prev.slice();
      copy[i] = clean;
      return copy;
    });
    if (clean && i < 5) {
      const next = document.getElementById(`pair-${i + 1}`) as HTMLInputElement | null;
      next?.focus();
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (!text) return;
    e.preventDefault();
    const next = ["", "", "", "", "", ""];
    for (let i = 0; i < text.length; i++) next[i] = text[i] ?? "";
    setDigits(next);
    const lastIdx = Math.min(text.length, 6) - 1;
    const target = document.getElementById(`pair-${lastIdx}`) as HTMLInputElement | null;
    target?.focus();
  }

  const allFilled = digits.every((d) => d.length === 1);

  async function handleSubmit() {
    if (!allFilled || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const code = digits.join("");
      const r = await window.betoff.api.pairWithCode(code);
      if (!r.ok) {
        setError(r.error ?? "Could not link this computer to your account.");
        return;
      }
      onPaired();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  // Auto-submit once all six digits are filled.
  useEffect(() => {
    if (allFilled && !submitting) handleSubmit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allFilled]);

  return (
    <div>
      <h1>Type the 6-digit code from your phone.</h1>
      <p>
        On your iPhone or Android, open Mindre På Spil → <strong>Settings → Link a computer</strong>{" "}
        and tap <strong>Generate code</strong>. Then type it here.
      </p>

      <div style={{ display: "flex", gap: 8, justifyContent: "center", margin: "32px 0 16px" }}>
        {digits.map((d, i) => (
          <input
            key={i}
            id={`pair-${i}`}
            className="input"
            value={d}
            onChange={(e) => setDigit(i, e.target.value)}
            onPaste={handlePaste}
            onKeyDown={(e) => {
              if (e.key === "Backspace" && !d && i > 0) {
                const prev = document.getElementById(`pair-${i - 1}`) as HTMLInputElement | null;
                prev?.focus();
              }
            }}
            inputMode="numeric"
            maxLength={1}
            style={{
              width: 44,
              height: 56,
              textAlign: "center",
              fontSize: 28,
              fontWeight: 600,
              padding: 0,
              fontFamily:
                "ui-monospace, SFMono-Regular, Menlo, monospace",
            }}
          />
        ))}
      </div>

      {error && <div className="banner error">{error}</div>}

      <button
        className="btn btn-block"
        onClick={handleSubmit}
        disabled={!allFilled || submitting}
        style={{ marginTop: 8 }}
      >
        {submitting ? "Linking…" : "Link this computer"}
      </button>

      <button
        className="btn btn-ghost btn-block"
        onClick={onBack}
        style={{ marginTop: 12 }}
      >
        Back
      </button>

      <p className="muted" style={{ marginTop: 16, textAlign: "center" }}>
        Codes expire after 10 minutes. Generate a fresh one on your phone if needed.
      </p>
    </div>
  );
}
