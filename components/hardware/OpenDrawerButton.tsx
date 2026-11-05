"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import toast from "react-hot-toast";
import { Archive } from "lucide-react";
import { useToggleState } from "@/components/layout/hooks";
import { COLORS, FONTS } from "@/components/layout/theme";
import { openCashDrawer } from "@/lib/hardware/drawerActions";
import { DRAWER_NOTE_MAX, DRAWER_QUICK_REASONS } from "@/lib/hardware/drawerKick";

// Open drawer by hand (the POS toolbar, the restaurant floor): a reason —
// a quick pick or typed — then this till's drawer opens, logged with who and
// why. Shown only to Open Drawer holders at a till with a drawer (`printer`).

export function OpenDrawerModal({ printer, onClose }: { printer: string; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, pending]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    const text = reason.trim();
    if (!text) {
      setError("Say why you're opening the drawer.");
      input.current?.focus();
      return;
    }
    setPending(true);
    setError(null);
    const result = await openCashDrawer({ reason: text });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (result.opened) toast.success(result.message);
    else toast(result.message);
    onClose();
  }

  return (
    <div
      onClick={() => !pending && onClose()}
      style={{ position: "fixed", inset: 0, background: "rgba(7,27,24,.44)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 90, padding: 16 }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="open-drawer-title"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => void submit(event)}
        style={{ width: "min(440px, 100%)", background: "#fff", borderRadius: 14, boxShadow: "0 24px 48px -12px rgba(7,27,24,.35)", padding: 24, display: "flex", flexDirection: "column", gap: 16, fontFamily: FONTS.body }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ width: 38, height: 38, borderRadius: 10, background: COLORS.tealTint, color: COLORS.tealDark, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Archive size={19} strokeWidth={1.7} />
          </span>
          <div>
            <h2 id="open-drawer-title" style={{ margin: 0, fontSize: 17, fontWeight: 700, color: COLORS.text }}>
              Open cash drawer
            </h2>
            <p style={{ margin: "2px 0 0", fontSize: 13, color: COLORS.slateMid }}>On {printer}. Logged with your name and the reason.</p>
          </div>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {DRAWER_QUICK_REASONS.map((pick) => {
            const on = reason === pick;
            return (
              <button
                key={pick}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  setReason(pick);
                  setError(null);
                }}
                style={{ height: 32, padding: "0 12px", borderRadius: 16, border: `1px solid ${on ? COLORS.teal : COLORS.borderStrong}`, background: on ? COLORS.tealTint : "#fff", color: on ? COLORS.tealDark : COLORS.slate, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}
              >
                {pick}
              </button>
            );
          })}
        </div>

        <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, fontWeight: 600, color: COLORS.text }}>
          Reason
          <input
            ref={input}
            value={reason}
            maxLength={DRAWER_NOTE_MAX}
            placeholder="Why are you opening the drawer?"
            aria-invalid={!!error}
            onChange={(event) => {
              setReason(event.target.value);
              setError(null);
            }}
            style={{ height: 40, border: `1px solid ${error ? COLORS.danger : COLORS.borderStrong}`, borderRadius: 8, padding: "0 12px", fontSize: 14, fontWeight: 400, color: COLORS.text, outline: "none" }}
          />
        </label>
        {error && (
          <p role="alert" style={{ margin: "-8px 0 0", fontSize: 12.5, color: COLORS.danger }}>
            {error}
          </p>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button type="button" onClick={onClose} disabled={pending} style={{ height: 38, padding: "0 18px", background: "#fff", border: `1px solid ${COLORS.borderStrong}`, borderRadius: 8, fontSize: 13.5, fontWeight: 600, color: COLORS.text, cursor: pending ? "not-allowed" : "pointer" }}>
            Cancel
          </button>
          <button type="submit" disabled={pending} style={{ height: 38, padding: "0 20px", background: pending ? COLORS.slateLight : COLORS.teal, border: "none", borderRadius: 8, fontSize: 13.5, fontWeight: 600, color: "#fff", cursor: pending ? "not-allowed" : "pointer" }}>
            {pending ? "Opening…" : "Open drawer"}
          </button>
        </div>
      </form>
    </div>
  );
}

// The header button (restaurant floor).
export default function OpenDrawerButton({ printer }: { printer: string }) {
  const [open, setOpen] = useState(false);
  const hover = useToggleState();
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        onMouseEnter={hover.on}
        onMouseLeave={hover.off}
        style={{ height: 36, padding: "0 14px", background: hover.value ? COLORS.tealTint : "#fff", border: `1px solid ${COLORS.borderStrong}`, borderRadius: 8, fontSize: 13.5, fontWeight: 600, color: COLORS.tealDark, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 7 }}
      >
        <Archive size={15} strokeWidth={1.8} /> Open drawer
      </button>
      {open && <OpenDrawerModal printer={printer} onClose={() => setOpen(false)} />}
    </>
  );
}
