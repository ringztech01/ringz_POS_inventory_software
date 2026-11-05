"use client";

import { useState, type FormEvent } from "react";
import toast from "react-hot-toast";
import { KeyRound } from "lucide-react";
import MasterDataModal from "@/components/ui/MasterDataModal";
import { Field, SelectInput } from "@/components/purchases/form-fields";
import { COLORS, FONTS } from "@/components/layout/theme";
import { formatNaira } from "@/lib/format";
import { WASTE_REASON_LABEL } from "../../lib/waste";
import { WASTE_NOTE_MAX, WASTE_REASONS, type LogWasteField } from "../../schemas/waste";
import { logWaste } from "../../server/actions/waste";
import type { Approver } from "../../server/queries/approvers";
import type { WasteItemOption } from "../../server/queries/waste";
import TextInput from "../TextInput";
import { useWastePreview } from "./useWastePreview";
import WasteItemPicker from "./WasteItemPicker";

const REASON_OPTIONS = WASTE_REASONS.map((r) => ({ value: r, label: WASTE_REASON_LABEL[r] }));
const QTY_TYPING = /^\d{0,9}(\.\d{0,3})?$/;


const box = { padding: 12, borderRadius: 10, background: COLORS.bgApp, display: "flex", flexDirection: "column", gap: 6 } as const;
const field = { height: 40, border: `1px solid ${COLORS.borderStrong}`, borderRadius: 8, padding: "0 12px", fontSize: 13.5, outline: "none", background: "#fff" } as const;

// Food › Waste › Log waste (the shared modal shell): the item (a menu item or
// an ingredient), how much in its own unit, why, a note (needed for Other).
// The cost is the server's (previewWasteCost) — worked out again on save —
// and above the approval limit an approver (Approve Waste) and their PIN
// are asked for.
export default function LogWasteModal({ items, approvers, onClose }: { items: WasteItemOption[]; approvers: Approver[]; onClose: () => void }) {
  const [item, setItem] = useState<WasteItemOption | null>(null);
  const [qty, setQty] = useState("1");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [approverId, setApproverId] = useState("");
  const [pin, setPin] = useState("");
  // The server asked for a PIN on save (the cost went up since the preview).
  const [pinAsked, setPinAsked] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<LogWasteField, string[]>>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const qtyReady = Number(qty) > 0;
  const preview = useWastePreview(item?.id ?? null, qty);
  const result = preview.state === "done" ? preview.result : null;
  const needsPin = (result?.ok && result.needsApproval) || pinAsked;
  const noteNeeded = reason === "OTHER";
  const ready =
    !!item && qtyReady && reason !== "" && (!noteNeeded || note.trim() !== "") && !(result && !result.ok) && (!needsPin || (approverId !== "" && pin.length >= 4)) && !saving;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || !item) return;
    setSaving(true);
    setError(null);
    setFieldErrors({});
    const outcome = await logWaste({
      productId: item.id,
      qty,
      unit: item.unit,
      reason,
      note: note.trim(),
      approval: needsPin ? { approverId, pin } : undefined,
    });
    setSaving(false);
    if (outcome.ok) {
      toast.success(`Waste logged · ${item.name} · ${formatNaira(outcome.costSnapshot)}`);
      onClose();
      return;
    }
    setError(outcome.error);
    setFieldErrors(outcome.fieldErrors ?? {});
    if ("needsApproval" in outcome && outcome.needsApproval) setPinAsked(true);
    setPin("");
  }

  return (
    <MasterDataModal title="Log waste" onClose={onClose} onSubmit={handleSubmit} submitting={saving} submitDisabled={!ready} submitLabel={needsPin ? "Approve & log" : "Log waste"} width={520}>
      <Field label="Item" required error={fieldErrors.productId?.[0]}>
        <WasteItemPicker
          items={items}
          value={item}
          autoFocus
          hasError={!!fieldErrors.productId}
          onChange={(next) => {
            setItem(next);
            setPinAsked(false);
          }}
        />
      </Field>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Quantity" required error={fieldErrors.qty?.[0]}>
          <TextInput
            ariaLabel="Quantity"
            value={qty}
            inputMode="numeric"
            hasError={!!fieldErrors.qty}
            onChange={(next) => {
              if (!QTY_TYPING.test(next)) return;
              setQty(next);
              setPinAsked(false);
            }}
          />
        </Field>
        <Field label="Unit" error={fieldErrors.unit?.[0]}>
          {/* Stock is kept in the item's own unit, so waste is logged in it. */}
          <span data-unit aria-label="Unit" title="Waste is logged in the item's own unit" style={{ ...field, display: "flex", alignItems: "center", background: COLORS.bgInput, color: item ? COLORS.ink : COLORS.slateLight, fontFamily: FONTS.mono, border: `1px solid ${COLORS.border}` }}>
            {item?.unit ?? "—"}
          </span>
        </Field>
      </div>

      <Field label="Reason" required error={fieldErrors.reason?.[0]}>
        <div data-field="reason">
          <SelectInput value={reason} onChange={setReason} options={REASON_OPTIONS} placeholder="Choose a reason" hasError={!!fieldErrors.reason} />
        </div>
      </Field>

      <Field label={noteNeeded ? "Note" : "Note (optional)"} required={noteNeeded} error={fieldErrors.note?.[0]}>
        <textarea
          aria-label="Note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={WASTE_NOTE_MAX}
          rows={2}
          placeholder={noteNeeded ? "Say what happened" : "e.g. Left out overnight"}
          style={{ border: `1px solid ${fieldErrors.note ? COLORS.danger : COLORS.borderStrong}`, borderRadius: 8, padding: "10px 12px", fontSize: 13.5, resize: "vertical", outline: "none", fontFamily: "inherit" }}
        />
      </Field>

      <div aria-label="Cost preview" aria-live="polite" data-preview={preview.state === "done" ? (result?.ok ? "ok" : "error") : preview.state} style={box}>
        {preview.state === "idle" ? (
          <span style={{ fontSize: 13, color: COLORS.slateMid }}>Pick an item and a quantity to see what it costs.</span>
        ) : preview.state === "loading" ? (
          <span style={{ fontSize: 13, color: COLORS.slateMid }}>Working out the cost…</span>
        ) : result && result.ok ? (
          <>
            <span style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: COLORS.slate }}>Cost</span>
              <span data-cost style={{ fontFamily: FONTS.display, fontSize: 20, fontWeight: 600 }}>
                {formatNaira(result.total)}
              </span>
            </span>
            <span data-takes style={{ fontSize: 12.5, color: COLORS.slateMid }}>
              Out of stock: {result.lines.map((l) => `${l.name} ${l.qty}${l.unit ? ` ${l.unit}` : ""}`).join(", ")}
            </span>
            {result.needsApproval && (
              <span data-over-limit style={{ fontSize: 12.5, color: "#8a5a00", fontWeight: 600 }}>
                Over the {result.limit} limit — an approver&apos;s PIN is needed.
              </span>
            )}
          </>
        ) : (
          <span role="alert" style={{ fontSize: 13, color: COLORS.danger }}>
            {result?.ok === false ? result.error : ""}
          </span>
        )}
      </div>

      {needsPin && (
        <div aria-label="Approval" style={{ ...box, gap: 8 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
            <KeyRound size={14} strokeWidth={1.8} /> Approval needed
          </span>
          {approvers.length === 0 ? (
            <span style={{ fontSize: 12.5, color: COLORS.slateMid }}>No one with Approve Waste has set an approval PIN yet.</span>
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
                style={{ ...field, letterSpacing: ".3em" }}
              />
            </div>
          )}
        </div>
      )}

      {error && (
        <p role="alert" data-error style={{ margin: 0, fontSize: 13, color: COLORS.danger }}>
          {error}
        </p>
      )}
    </MasterDataModal>
  );
}
