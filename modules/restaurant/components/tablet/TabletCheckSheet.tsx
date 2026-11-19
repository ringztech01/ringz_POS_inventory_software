"use client";

import { useState } from "react";
import { CANCEL_REASONS, cancelReasonsFor, type CancelReason } from "../../lib/cancelReasons";
import { toggleQuickNote, hasQuickNote } from "../../lib/optionFlow";
import type { LineTag } from "../../lib/tabletOrder";
import type { Approver } from "../../server/queries/approvers";
import type { CancelOutcome } from "../order/CancelModal";
import type { ManagerApproval } from "../pos/useManagerApproval";

// The tablet's check (Part 6g Step 5; design: the Order sheet): every line
// with how many, its options and note, and NEW / SENT / VOID; a tap on a
// line gives −, +, NOTE and VOID. − / + only change a line not sent yet; a
// sent line can only be voided — with a reason, and a manager's PIN right
// here when this user can't approve voids (Part 6f). NOTE is the quick-note
// grid (Part 6e). The subtotal, VAT and total along the bottom.

export type CheckLine = {
  key: string;
  // null: a tap still saving (it can't be changed yet).
  id: string | null;
  name: string;
  quantity: number;
  options: string[];
  note: string | null;
  tag: LineTag;
  amount: string;
  served: boolean;
  // A tap not on the server yet: saving now, or waiting for the connection.
  waiting?: boolean;
};

type Props = {
  title: string;
  lines: CheckLine[];
  totals: { subTotal: string; tax: string; taxLabel: string; total: string; discount: { label: string; amount: string } | null; serviceCharge: string; servicePercent: string };
  quickNotes: string[];
  approvers: Approver[];
  canWaste: boolean;
  busy: boolean;
  onStep: (line: CheckLine, by: 1 | -1) => void;
  onNote: (line: CheckLine, note: string) => void;
  onRemove: (line: CheckLine) => void;
  onVoid: (line: CheckLine, reason: CancelReason, wasted: boolean, managerApproval?: ManagerApproval) => Promise<CancelOutcome>;
  onClose: () => void;
};

const TAG: Record<LineTag, [string, string]> = { SENT: ["#E2E2DE", "#3C403B"], NEW: ["#FFE08A", "#5C3D00"], VOID: ["#FFD6D6", "#A11111"] };
const black = (extra: React.CSSProperties = {}) => ({ height: 84, border: "none", borderRadius: 8, background: "#000", color: "#fff", fontWeight: 900, fontFamily: "inherit", cursor: "pointer", ...extra }) as const;

export default function TabletCheckSheet(props: Props) {
  const { lines, totals, busy } = props;
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [mode, setMode] = useState<{ kind: "note"; line: CheckLine; note: string } | { kind: "void"; line: CheckLine; reason: CancelReason | null; wasted: boolean } | { kind: "manager"; line: CheckLine; reason: CancelReason; wasted: boolean; approverId: string | null; pin: string; error: string | null } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const selected = lines.find((l) => l.key === selectedKey && l.tag !== "VOID") ?? null;

  async function voidNow(line: CheckLine, reason: CancelReason, wasted: boolean, approval?: ManagerApproval) {
    const outcome = await props.onVoid(line, reason, wasted, approval);
    if (outcome.ok) {
      setMode(null);
      setSelectedKey(null);
      return;
    }
    // A manager's PIN wanted — or the one typed was refused: the pad stays,
    // with what the server said, for another try.
    if (outcome.needsManager || (approval && !outcome.needsApproval)) return setMode({ kind: "manager", line, reason, wasted, approverId: approval?.approverId ?? props.approvers[0]?.id ?? null, pin: "", error: approval ? (outcome.error ?? "That PIN isn't right.") : null });
    setMode(null);
    setMessage(outcome.needsApproval ? "Logging this as waste needs a waste approval: use the desktop POS." : (outcome.error ?? "Couldn't void that line."));
  }

  function pinKey(key: string) {
    if (mode?.kind !== "manager" || busy) return;
    if (key === "CLEAR") return setMode({ ...mode, pin: "", error: null });
    if (key === "⌫") return setMode({ ...mode, pin: mode.pin.slice(0, -1) });
    const pin = (mode.pin + key).slice(0, 4);
    setMode({ ...mode, pin, error: null });
    if (pin.length === 4 && mode.approverId) void voidNow(mode.line, mode.reason, mode.wasted, { approverId: mode.approverId, pin });
  }

  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 30, background: "rgba(0,0,0,.7)", display: "flex", alignItems: "flex-end" }}>
      <div role="dialog" aria-modal="true" data-check-sheet style={{ width: "100%", height: "min(1040px, 92%)", background: "#fff", color: "#000", borderRadius: "18px 18px 0 0", display: "flex", flexDirection: "column" }}>
        <div style={{ height: 92, flex: "none", display: "flex", alignItems: "center", gap: 14, padding: "0 24px", borderBottom: "3px solid #000" }}>
          <span style={{ fontSize: 32, fontWeight: 900, flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{props.title} · Order</span>
          <button type="button" className="tb-press" data-check-close onClick={props.onClose} style={{ ...black({ height: 64, padding: "0 26px", fontSize: 20 }) }}>
            CLOSE ▾
          </button>
        </div>

        {message && (
          <div role="alert" data-check-message onClick={() => setMessage(null)} style={{ padding: "14px 24px", background: "#FFF1F1", color: "#A11111", fontSize: 18, fontWeight: 800 }}>
            {message}
          </div>
        )}

        {mode?.kind === "note" ? (
          <div data-note-panel style={{ flex: 1, overflowY: "auto", padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
            <span style={{ fontSize: 26, fontWeight: 900 }}>Note · {mode.line.name}</span>
            <div data-note-text style={{ minHeight: 64, padding: "16px 18px", borderRadius: 8, background: "#F0F0EC", fontSize: 22, fontWeight: 800 }}>
              {mode.note || <span style={{ color: "#8A8E8A" }}>Tap a note below</span>}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gridAutoRows: 84, gap: 10 }}>
              {props.quickNotes.map((phrase) => {
                const on = hasQuickNote(mode.note, phrase);
                return (
                  <button key={phrase} type="button" className="tb-press" data-quick-note={phrase} aria-pressed={on} onClick={() => setMode({ ...mode, note: toggleQuickNote(mode.note, phrase) })} style={{ ...black({ fontSize: 20, background: on ? "#0B8A73" : "#000" }) }}>
                    {phrase}
                  </button>
                );
              })}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 2fr", gap: 10, marginTop: "auto" }}>
              <button type="button" className="tb-press" onClick={() => setMode(null)} style={{ ...black({ background: "#E2E2DE", color: "#000", fontSize: 20 }) }}>
                CANCEL
              </button>
              <button type="button" className="tb-press" data-note-clear onClick={() => setMode({ ...mode, note: "" })} style={{ ...black({ background: "#E2E2DE", color: "#000", fontSize: 20 }) }}>
                CLEAR
              </button>
              <button
                type="button"
                className="tb-press"
                data-note-save
                disabled={busy}
                onClick={() => {
                  props.onNote(mode.line, mode.note);
                  setMode(null);
                }}
                style={{ ...black({ background: "#0B8A73", fontSize: 22 }) }}
              >
                SAVE NOTE
              </button>
            </div>
          </div>
        ) : mode?.kind === "void" ? (
          <div data-void-panel style={{ flex: 1, overflowY: "auto", padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
            <span style={{ fontSize: 26, fontWeight: 900 }}>
              Void {mode.line.quantity}× {mode.line.name}?
            </span>
            <span style={{ fontSize: 18, fontWeight: 700, color: "#55595A" }}>It&apos;s been sent: the kitchen sees it cancelled. Why?</span>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gridAutoRows: 84, gap: 10 }}>
              {cancelReasonsFor({ served: mode.line.served })
                .filter((r) => r !== "OTHER")
                .map((reason) => (
                  <button key={reason} type="button" className="tb-press" data-void-reason={reason} aria-pressed={mode.reason === reason} onClick={() => setMode({ ...mode, reason, wasted: reason === "RETURNED_BY_GUEST" ? mode.wasted : false })} style={{ ...black({ fontSize: 20, background: mode.reason === reason ? "#C21F1F" : "#000" }) }}>
                    {CANCEL_REASONS[reason]}
                  </button>
                ))}
            </div>
            {mode.reason === "RETURNED_BY_GUEST" && props.canWaste && (
              <button type="button" className="tb-press" data-void-waste aria-pressed={mode.wasted} onClick={() => setMode({ ...mode, wasted: !mode.wasted })} style={{ ...black({ fontSize: 20, background: mode.wasted ? "#0B8A73" : "#E2E2DE", color: mode.wasted ? "#fff" : "#000" }) }}>
                {mode.wasted ? "✓ Logged as waste" : "Log it as waste"}
              </button>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10, marginTop: "auto" }}>
              <button type="button" className="tb-press" onClick={() => setMode(null)} style={{ ...black({ background: "#E2E2DE", color: "#000", fontSize: 20 }) }}>
                CANCEL
              </button>
              <button type="button" className="tb-press" data-void-confirm disabled={!mode.reason || busy} onClick={() => mode.reason && void voidNow(mode.line, mode.reason, mode.wasted)} style={{ ...black({ background: "#C21F1F", fontSize: 22, opacity: mode.reason ? 1 : 0.45 }) }}>
                VOID
              </button>
            </div>
          </div>
        ) : mode?.kind === "manager" ? (
          <div data-manager-pin style={{ flex: 1, overflowY: "auto", padding: "20px 24px", display: "flex", flexDirection: "column", gap: 14 }}>
            <span style={{ fontSize: 26, fontWeight: 900 }}>A manager&apos;s PIN to void {mode.line.name}</span>
            {props.approvers.length === 0 ? (
              <span style={{ fontSize: 18, fontWeight: 700, color: "#A11111" }}>No one who can approve voids has a PIN yet (an Administrator sets them on Settings › Staff).</span>
            ) : (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {props.approvers.map((a) => (
                  <button key={a.id} type="button" className="tb-press" data-approver={a.name} aria-pressed={mode.approverId === a.id} onClick={() => setMode({ ...mode, approverId: a.id, pin: "", error: null })} style={{ ...black({ height: 64, padding: "0 20px", fontSize: 19, background: mode.approverId === a.id ? "#0B8A73" : "#E2E2DE", color: mode.approverId === a.id ? "#fff" : "#000" }) }}>
                    {a.name}
                  </button>
                ))}
              </div>
            )}
            <div data-manager-dots={mode.pin.length} style={{ display: "flex", gap: 22, justifyContent: "center", margin: "6px 0" }}>
              {[0, 1, 2, 3].map((i) => (
                <span key={i} style={{ width: 30, height: 30, borderRadius: "50%", boxSizing: "border-box", border: `4px solid ${mode.error ? "#C21F1F" : "#000"}`, background: mode.error ? "#C21F1F" : i < mode.pin.length ? "#000" : "transparent" }} />
              ))}
            </div>
            <span data-manager-error role="alert" style={{ minHeight: 24, textAlign: "center", fontSize: 18, fontWeight: 800, color: "#A11111" }}>
              {mode.error ?? ""}
            </span>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gridAutoRows: 84, gap: 10 }}>
              {["1", "2", "3", "4", "5", "6", "7", "8", "9", "CLEAR", "0", "⌫"].map((k) => (
                <button key={k} type="button" className="tb-press" data-manager-key={k} disabled={!mode.approverId || busy} onClick={() => pinKey(k)} style={{ ...black({ fontSize: k === "CLEAR" ? 20 : 36, background: k === "CLEAR" || k === "⌫" ? "#3C403B" : "#000" }) }}>
                  {k}
                </button>
              ))}
            </div>
            <button type="button" className="tb-press" onClick={() => setMode(null)} style={{ ...black({ background: "#E2E2DE", color: "#000", fontSize: 20 }) }}>
              CANCEL
            </button>
          </div>
        ) : (
          <>
            <div data-check-lines style={{ flex: 1, overflowY: "auto" }}>
              {lines.length === 0 && <div style={{ padding: 32, fontSize: 20, fontWeight: 700, color: "#55595A" }}>No items yet. Tap a dish to add it.</div>}
              {lines.map((l) => {
                const on = l.key === selectedKey;
                const [tagBg, tagFg] = TAG[l.tag];
                const voided = l.tag === "VOID";
                const detail = [...l.options, ...(l.note ? [`» ${l.note}`] : [])].join(" · ");
                return (
                  <div
                    key={l.key}
                    role="button"
                    tabIndex={0}
                    data-check-line={l.name}
                    data-tag={l.tag}
                    aria-pressed={on}
                    onClick={() => !voided && l.id && setSelectedKey(on ? null : l.key)}
                    style={{ display: "grid", gridTemplateColumns: "64px minmax(0, 1fr) auto", gap: 14, padding: "18px 24px", borderBottom: "1px solid #E2E2DE", background: on ? "#DDF3EE" : l.tag === "NEW" ? "#FFFBEA" : "#fff", cursor: voided || !l.id ? "default" : "pointer" }}
                  >
                    <span style={{ fontSize: 30, fontWeight: 900, color: voided ? "#A11111" : "#000" }}>{l.quantity}×</span>
                    <span style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                      <span style={{ fontSize: 22, fontWeight: 800, color: voided ? "#A11111" : "#000", textDecoration: voided ? "line-through" : "none" }}>{l.name}</span>
                      {detail && <span style={{ fontSize: 17, fontWeight: 600, color: "#55595A" }}>{detail}</span>}
                      <span data-line-tag data-waiting={l.waiting ? "" : undefined} style={{ alignSelf: "flex-start", fontSize: 13, fontWeight: 900, letterSpacing: ".06em", padding: "4px 10px", borderRadius: 4, background: tagBg, color: tagFg }}>
                        {l.id ? l.tag : l.waiting ? "WAITING TO SYNC" : "SAVING"}
                      </span>
                    </span>
                    <span style={{ fontSize: 22, fontWeight: 800, color: voided ? "#A11111" : "#000", textDecoration: voided ? "line-through" : "none" }}>{l.amount}</span>
                  </div>
                );
              })}
            </div>
            {selected && (
              <div data-line-actions style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10, padding: "14px 16px", background: "#F0F0EC", borderTop: "1px solid #DADAD4" }}>
                <button type="button" className="tb-press" data-line-less disabled={busy} onClick={() => (selected.tag === "SENT" ? setMessage("Already sent · use VOID") : props.onStep(selected, -1))} style={{ ...black({ fontSize: 40 }) }}>
                  −
                </button>
                <button type="button" className="tb-press" data-line-more disabled={busy} onClick={() => (selected.tag === "SENT" ? setMessage("Already sent · add it again from the menu") : props.onStep(selected, 1))} style={{ ...black({ fontSize: 40 }) }}>
                  +
                </button>
                <button type="button" className="tb-press" data-line-note disabled={busy} onClick={() => (selected.tag === "SENT" ? setMessage("Already sent · a note can't change it now") : setMode({ kind: "note", line: selected, note: selected.note ?? "" }))} style={{ ...black({ fontSize: 21 }) }}>
                  NOTE
                </button>
                <button
                  type="button"
                  className="tb-press"
                  data-line-void
                  disabled={busy}
                  onClick={() => {
                    if (selected.tag === "NEW") {
                      props.onRemove(selected);
                      setSelectedKey(null);
                    } else setMode({ kind: "void", line: selected, reason: null, wasted: false });
                  }}
                  style={{ ...black({ fontSize: 21, background: "#C21F1F" }) }}
                >
                  VOID
                </button>
              </div>
            )}
          </>
        )}

        <div style={{ padding: "16px 24px 28px", borderTop: "3px solid #000", display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flex: "none" }}>
          <span data-check-sums style={{ fontSize: 20, fontWeight: 700, color: "#55595A" }}>
            Subtotal {totals.subTotal}
            {totals.discount ? ` · ${totals.discount.label} −${totals.discount.amount}` : ""}
            {totals.servicePercent !== "off" && totals.serviceCharge !== "₦0.00" ? ` · Service ${totals.serviceCharge}` : ""} · {totals.taxLabel || "VAT"} {totals.tax}
          </span>
          <span data-check-total style={{ fontSize: 40, fontWeight: 900 }}>
            {totals.total}
          </span>
        </div>
      </div>
    </div>
  );
}
