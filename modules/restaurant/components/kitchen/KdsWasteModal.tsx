"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { WasteReason } from "@prisma/client";
import { KeyRound, Minus, Plus, X } from "lucide-react";
import { FONTS } from "@/components/layout/theme";
import { formatNaira } from "@/lib/format";
import { KDS } from "../../lib/theme";
import { WASTE_REASON_LABEL } from "../../lib/waste";
import { REMAKE_REASONS, WASTE_NOTE_MAX, WASTE_REASONS } from "../../schemas/waste";
import { loadWasteOptions, logWaste, remakeKitchenLine } from "../../server/actions/waste";
import type { Approver } from "../../server/queries/approvers";
import type { KdsLine } from "../../server/queries/kds";
import type { WasteItemOption } from "../../server/queries/waste";
import { useWastePreview } from "../food/useWastePreview";
import WasteItemPicker from "../food/WasteItemPicker";

// The kitchen display's waste pop-up (dark, RingzPOS Kitchen Display; every
// target at least 44px):
//   log     the header's Log waste — Food › Waste's fields: item, quantity,
//           its unit, reason, note — logged with the server's cost
//   remake  a ticket line's Remake — how many of it were spoilt, Burnt or
//           Dropped, a note — logged as waste and sent again at no charge
// The cost is the server's (previewWasteCost); above the approval limit an
// approver (Approve Waste) and their PIN are asked for.

export type KdsWasteMode = { kind: "log" } | { kind: "remake"; line: KdsLine; table: string };

const QTY_TYPING = /^\d{0,9}(\.\d{0,3})?$/;
const TOUCH = 48;

const field = { height: TOUCH, border: `1px solid ${KDS.buttonBorder}`, borderRadius: 9, padding: "0 14px", fontSize: 16, outline: "none", background: KDS.card, color: KDS.text } as const;
const label = { fontSize: 12, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: KDS.muted } as const;

function Field({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={label}>{name}</span>
      {children}
    </div>
  );
}

function Choice({ on, children, onClick, name }: { on: boolean; children: ReactNode; onClick: () => void; name: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      data-choice={name}
      onClick={onClick}
      style={{ minHeight: TOUCH, padding: "0 10px", borderRadius: 9, border: on ? `2px solid ${KDS.qty}` : `1px solid ${KDS.buttonBorder}`, background: on ? KDS.teal : "transparent", color: KDS.text, fontSize: 15, fontWeight: 600, cursor: "pointer" }}
    >
      {children}
    </button>
  );
}

const square = { width: TOUCH, height: TOUCH, borderRadius: 9, border: `1px solid ${KDS.buttonBorder}`, background: "transparent", color: KDS.text, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" } as const;

export default function KdsWasteModal({ mode, onDone, onClose }: { mode: KdsWasteMode; onDone: (message: string) => void; onClose: () => void }) {
  const remake = mode.kind === "remake" ? mode.line : null;
  // The items and approvers, fetched as it opens (the board refreshes every
  // 5s, so they aren't part of its data).
  const [options, setOptions] = useState<{ items: WasteItemOption[]; approvers: Approver[] } | null>(null);
  useEffect(() => {
    let live = true;
    void loadWasteOptions().then((loaded) => {
      if (!live) return;
      if (loaded.ok) setOptions({ items: loaded.items, approvers: loaded.approvers });
      else setOptions({ items: [], approvers: [] });
    });
    return () => {
      live = false;
    };
  }, []);
  const approvers = options?.approvers ?? [];
  const [item, setItem] = useState<WasteItemOption | null>(null);
  const [qty, setQty] = useState("1");
  const [reason, setReason] = useState<WasteReason | null>(null);
  const [note, setNote] = useState("");
  const [approverId, setApproverId] = useState("");
  const [pin, setPin] = useState("");
  const [pinAsked, setPinAsked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const productId = remake ? remake.productId : (item?.id ?? null);
  const preview = useWastePreview(productId, qty);
  const result = preview.state === "done" ? preview.result : null;
  const needsPin = (result?.ok && result.needsApproval) || pinAsked;
  const noteNeeded = reason === "OTHER";
  const reasons: readonly WasteReason[] = remake ? REMAKE_REASONS : WASTE_REASONS;
  const ready =
    !!productId && Number(qty) > 0 && !!reason && (!noteNeeded || note.trim() !== "") && !(result && !result.ok) && (!needsPin || (approverId !== "" && pin.length >= 4)) && !saving;

  async function submit() {
    if (!ready || !reason) return;
    setSaving(true);
    setError(null);
    const approval = needsPin ? { approverId, pin } : undefined;
    const outcome = remake
      ? await remakeKitchenLine({ itemId: remake.itemId, qty: Number(qty), reason, note: note.trim(), approval })
      : await logWaste({ productId: item!.id, qty, unit: item!.unit, reason, note: note.trim(), approval });
    setSaving(false);
    if (outcome.ok) {
      const cost = formatNaira(outcome.costSnapshot);
      onDone(remake && "station" in outcome ? `Remake of ${qty}× ${remake.name} sent to ${outcome.station} · waste ${cost} logged.` : `Waste logged · ${item?.name} · ${cost}`);
      return;
    }
    setError(outcome.error);
    if ("needsApproval" in outcome && outcome.needsApproval) setPinAsked(true);
    setPin("");
  }

  const changeQty = (next: string) => {
    setQty(next);
    setPinAsked(false);
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 90, padding: 16 }}>
      <div
        role="dialog"
        aria-label={remake ? "Remake" : "Log waste"}
        onClick={(event) => event.stopPropagation()}
        style={{ width: 520, maxWidth: "100%", maxHeight: "100%", overflowY: "auto", background: KDS.header, color: KDS.text, border: `1px solid ${KDS.divider}`, borderRadius: 14, padding: 22, display: "flex", flexDirection: "column", gap: 16 }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontFamily: FONTS.display, fontSize: 20, fontWeight: 600 }}>{remake ? `Remake ${remake.name}` : "Log waste"}</span>
            {remake && (
              <span style={{ fontSize: 13, color: KDS.muted }}>
                {mode.kind === "remake" ? mode.table : ""} · {remake.quantity}× on the ticket · no charge to the guest
              </span>
            )}
          </div>
          <button type="button" aria-label="Close" onClick={onClose} style={{ ...square, border: "none" }}>
            <X size={20} strokeWidth={2} />
          </button>
        </div>

        {!remake && (
          <Field name="Item">
            <WasteItemPicker
              dark
              autoFocus
              items={options?.items ?? []}
              value={item}
              onChange={(next) => {
                setItem(next);
                setPinAsked(false);
              }}
            />
          </Field>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field name={remake ? "How many spoilt" : "Quantity"}>
            {remake ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button type="button" aria-label="One less" disabled={Number(qty) <= 1} onClick={() => changeQty(String(Math.max(1, Number(qty) - 1)))} style={square}>
                  <Minus size={18} strokeWidth={2} />
                </button>
                <span data-remake-qty style={{ minWidth: 40, textAlign: "center", fontFamily: FONTS.mono, fontSize: 20, fontWeight: 600 }}>
                  {qty}
                </span>
                <button type="button" aria-label="One more" disabled={Number(qty) >= remake.quantity} onClick={() => changeQty(String(Math.min(remake.quantity, Number(qty) + 1)))} style={square}>
                  <Plus size={18} strokeWidth={2} />
                </button>
              </div>
            ) : (
              <input aria-label="Quantity" inputMode="decimal" value={qty} onChange={(event) => QTY_TYPING.test(event.target.value) && changeQty(event.target.value)} style={field} />
            )}
          </Field>
          <Field name="Unit">
            <span data-unit style={{ ...field, display: "flex", alignItems: "center", fontFamily: FONTS.mono, color: KDS.soft, background: "transparent" }}>
              {remake ? "dish" : (item?.unit ?? "—")}
            </span>
          </Field>
        </div>

        <Field name="Reason">
          <div role="radiogroup" aria-label="Reason" style={{ display: "grid", gridTemplateColumns: remake ? "1fr 1fr" : "1fr 1fr 1fr", gap: 8 }}>
            {reasons.map((r) => (
              <Choice key={r} name={r} on={reason === r} onClick={() => setReason(r)}>
                {WASTE_REASON_LABEL[r]}
              </Choice>
            ))}
          </div>
        </Field>

        <Field name={noteNeeded ? "Note (required)" : "Note (optional)"}>
          <textarea
            aria-label="Note"
            value={note}
            maxLength={WASTE_NOTE_MAX}
            rows={2}
            onChange={(event) => setNote(event.target.value)}
            placeholder={noteNeeded ? "Say what happened" : remake ? "e.g. Left on the grill" : "e.g. Left out overnight"}
            style={{ ...field, height: "auto", minHeight: 64, padding: "12px 14px", resize: "vertical", fontFamily: "inherit" }}
          />
        </Field>

        <div aria-label="Cost preview" aria-live="polite" data-preview={preview.state === "done" ? (result?.ok ? "ok" : "error") : preview.state} style={{ padding: 14, borderRadius: 10, background: KDS.card, display: "flex", flexDirection: "column", gap: 6 }}>
          {preview.state === "idle" ? (
            <span style={{ fontSize: 14, color: KDS.muted }}>Pick an item and a quantity to see what it costs.</span>
          ) : preview.state === "loading" ? (
            <span style={{ fontSize: 14, color: KDS.muted }}>Working out the cost…</span>
          ) : result && result.ok ? (
            <>
              <span style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: KDS.soft }}>Waste cost</span>
                <span data-cost style={{ fontFamily: FONTS.display, fontSize: 22, fontWeight: 600 }}>
                  {formatNaira(result.total)}
                </span>
              </span>
              <span data-takes style={{ fontSize: 13, color: KDS.muted }}>
                Out of stock: {result.lines.map((l) => `${l.name} ${l.qty}${l.unit ? ` ${l.unit}` : ""}`).join(", ")}
              </span>
              {result.needsApproval && (
                <span data-over-limit style={{ fontSize: 13, color: KDS.note, fontWeight: 600 }}>
                  Over the {result.limit} limit — an approver&apos;s PIN is needed.
                </span>
              )}
            </>
          ) : (
            <span role="alert" style={{ fontSize: 14, color: KDS.lateText }}>
              {result?.ok === false ? result.error : ""}
            </span>
          )}
        </div>

        {needsPin && (
          <div aria-label="Approval" style={{ padding: 14, borderRadius: 10, background: KDS.card, display: "flex", flexDirection: "column", gap: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
              <KeyRound size={15} strokeWidth={1.8} /> Approval needed
            </span>
            {approvers.length === 0 ? (
              <span style={{ fontSize: 13, color: KDS.muted }}>No one with Approve Waste has set an approval PIN yet.</span>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <select aria-label="Approver" value={approverId} onChange={(event) => setApproverId(event.target.value)} style={field}>
                  <option value="">Choose the approver…</option>
                  {approvers.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
                <input
                  aria-label="Approver PIN"
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="Their PIN"
                  maxLength={6}
                  value={pin}
                  onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))}
                  onKeyDown={(event) => event.key === "Enter" && void submit()}
                  style={{ ...field, letterSpacing: ".3em" }}
                />
              </div>
            )}
          </div>
        )}

        {error && (
          <p role="alert" data-error style={{ margin: 0, fontSize: 14, color: KDS.lateText }}>
            {error}
          </p>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10 }}>
          <button type="button" onClick={onClose} disabled={saving} style={{ height: 52, borderRadius: 10, border: `1px solid ${KDS.buttonBorder}`, background: "transparent", color: KDS.text, fontSize: 15, fontWeight: 600, cursor: "pointer" }}>
            Cancel
          </button>
          <button
            type="button"
            data-submit
            disabled={!ready}
            onClick={() => void submit()}
            style={{ height: 52, borderRadius: 10, border: "none", background: ready ? KDS.teal : KDS.divider, color: ready ? "#fff" : KDS.faint, fontSize: 15, fontWeight: 700, cursor: ready ? "pointer" : "not-allowed" }}
          >
            {saving ? "Saving…" : needsPin ? (remake ? "Approve & remake" : "Approve & log") : remake ? "Remake & send" : "Log waste"}
          </button>
        </div>
      </div>
    </div>
  );
}
