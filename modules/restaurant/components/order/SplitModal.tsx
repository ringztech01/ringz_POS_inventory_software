"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Minus, Plus, X } from "lucide-react";
import { COLORS, FONTS } from "@/components/layout/theme";
import { formatNaira } from "@/lib/format";
import { MAX_BILL_PARTS, splitByAmounts, splitEqually } from "../../lib/billSplit";
import { R } from "../../lib/theme";
import type { BillSplit } from "../../schemas/bill";
import type { BillView } from "../../server/queries/bill";

type Mode = BillSplit["mode"];
const MODES: [Mode, string][] = [
  ["EQUAL", "Equal split"],
  ["ITEMS", "By item"],
  ["AMOUNT", "By amount"],
];
const clampParts = (n: number) => Math.max(2, Math.min(MAX_BILL_PARTS, n));
const field = { height: 38, border: `1px solid ${COLORS.borderStrong}`, borderRadius: 8, padding: "0 12px", fontSize: 13.5, outline: "none" } as const;

function Stepper({ value, min, max, label, onChange }: { value: number; min: number; max: number; label: string; onChange: (n: number) => void }) {
  const button = (disabled: boolean) =>
    ({ width: 26, height: 26, border: `1px solid ${COLORS.borderStrong}`, borderRadius: 7, background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.4 : 1, padding: 0 }) as const;
  return (
    <span role="group" aria-label={label} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <button type="button" aria-label={`Fewer: ${label}`} disabled={value <= min} onClick={() => onChange(value - 1)} style={button(value <= min)}>
        <Minus size={13} strokeWidth={2} />
      </button>
      <span style={{ minWidth: 18, textAlign: "center", fontFamily: FONTS.mono, fontSize: 13 }}>{value}</span>
      <button type="button" aria-label={`More: ${label}`} disabled={value >= max} onClick={() => onChange(value + 1)} style={button(value >= max)}>
        <Plus size={13} strokeWidth={2} />
      </button>
    </span>
  );
}

function PreviewRow({ label, value, note }: { label: string; value: string; note?: ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5, padding: "6px 0", borderBottom: `1px solid ${R.rowBorder}` }}>
      <span>
        {label}
        {note}
      </span>
      <span style={{ fontWeight: 600 }}>{value}</span>
    </div>
  );
}

// Split bill (Bill panel): equal N ways, by item (who had what) or by
// amount (the last part pays the rest). The previews here are only a
// guide; the server works out and saves the parts, to the kobo, with any
// rounding on the last part.
export default function SplitModal({
  bill,
  onSubmit,
  onClose,
}: {
  bill: BillView;
  // Resolves true when the server accepted it (the pop-up then closes).
  onSubmit: (split: BillSplit) => Promise<boolean>;
  onClose: () => void;
}) {
  const startParts = clampParts(bill.order.guests);
  const [mode, setMode] = useState<Mode>(bill.split?.mode ?? "EQUAL");
  const [ways, setWays] = useState(bill.split?.mode === "EQUAL" ? bill.split.parts.length : startParts);
  const [amounts, setAmounts] = useState<string[]>([""]);
  const [guests, setGuests] = useState(startParts);
  // By item: per line, how many units each guest pays for.
  const [assigned, setAssigned] = useState<Record<string, number[]>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const total = bill.totals.totalValue;
  const unitsOf = (lineId: string) => (assigned[lineId] ?? []).slice(0, guests);
  const assignedCount = (lineId: string) => unitsOf(lineId).reduce((n, q) => n + (q ?? 0), 0);
  const setUnits = (lineId: string, guest: number, quantity: number) =>
    setAssigned((current) => {
      const row = Array.from({ length: guests }, (_, g) => current[lineId]?.[g] ?? 0);
      row[guest] = quantity;
      return { ...current, [lineId]: row };
    });
  // A guest's column header: everything not yet assigned goes to them.
  const giveRest = (guest: number) =>
    setAssigned((current) => {
      const next = { ...current };
      for (const line of bill.lines) {
        const row = Array.from({ length: guests }, (_, g) => current[line.id]?.[g] ?? 0);
        row[guest] += line.quantity - row.reduce((n, q) => n + q, 0);
        next[line.id] = row;
      }
      return next;
    });

  let problem: string | null = null;
  let preview: ReactNode = null;
  if (mode === "EQUAL") {
    const result = splitEqually(total, ways);
    if (!result.ok) problem = result.error;
    else
      preview = result.amounts.map((amount, i) => <PreviewRow key={i} label={`${i + 1} of ${ways}`} value={formatNaira(amount.toFixed(2))} />);
  } else if (mode === "AMOUNT") {
    const typed = amounts.map((a) => a.trim());
    const result = typed.every((a) => /^\d{1,10}(\.\d{1,2})?$/.test(a)) ? splitByAmounts(total, typed) : null;
    if (!result) problem = "Enter an amount for each part, like 5000 or 2500.50.";
    else if (!result.ok) problem = result.error;
    else preview = <PreviewRow label={`Part ${amounts.length + 1}`} value={formatNaira(result.amounts[amounts.length].toFixed(2))} note={<span style={{ color: COLORS.slateMid }}> — the rest</span>} />;
  } else {
    const short = bill.lines.find((line) => assignedCount(line.id) !== line.quantity);
    const empty = Array.from({ length: guests }, (_, g) => g).find((g) => bill.lines.every((line) => !(unitsOf(line.id)[g] > 0)));
    if (short) problem = `Assign every ${short.name} (${assignedCount(short.id)} of ${short.quantity}).`;
    else if (empty !== undefined) problem = `Guest ${empty + 1} has nothing assigned yet.`;
  }
  const ready = !problem && !saving && !bill.settleBlocker;

  async function submit() {
    if (!ready) return;
    const split: BillSplit =
      mode === "EQUAL" ? { mode, ways }
      : mode === "AMOUNT" ? { mode, amounts: amounts.map((a) => a.trim()) }
      : {
          mode,
          parts: Array.from({ length: guests }, (_, g) =>
            bill.lines.flatMap((line) => (unitsOf(line.id)[g] > 0 ? [{ lineId: line.id, quantity: unitsOf(line.id)[g] }] : [])),
          ),
        };
    setSaving(true);
    const accepted = await onSubmit(split);
    setSaving(false);
    if (accepted) onClose();
  }

  return (
    // Shown over the Bill panel: a click outside closes this pop-up only.
    <div
      onClick={(event) => {
        event.stopPropagation();
        onClose();
      }}
      style={{ position: "fixed", inset: 0, background: "rgba(23,27,28,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 90 }}
    >
      <div
        role="dialog"
        aria-label="Split bill"
        onClick={(event) => event.stopPropagation()}
        style={{ width: 640, maxWidth: "calc(100vw - 32px)", maxHeight: "88vh", background: "#fff", borderRadius: 14, padding: 22, display: "flex", flexDirection: "column", gap: 12 }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontFamily: FONTS.display, fontSize: 19, fontWeight: 600 }}>
            Split bill · {bill.totals.total}
          </span>
          <button type="button" aria-label="Close" onClick={onClose} style={{ border: "none", background: "none", cursor: "pointer", color: COLORS.slateMid, display: "flex" }}>
            <X size={18} strokeWidth={1.8} />
          </button>
        </div>

        <div role="tablist" aria-label="Split mode" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
          {MODES.map(([key, label]) => {
            const on = mode === key;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setMode(key)}
                style={{ height: 38, border: on ? `2px solid ${COLORS.teal}` : `1px solid ${COLORS.borderStrong}`, borderRadius: 8, background: "#fff", fontSize: 13.5, fontWeight: on ? 600 : 400, cursor: "pointer" }}
              >
                {label}
              </button>
            );
          })}
        </div>

        <div style={{ overflowY: "auto", minHeight: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          {mode === "EQUAL" && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 13.5 }}>
                Split
                <Stepper value={ways} min={2} max={MAX_BILL_PARTS} label="Ways" onChange={setWays} />
                ways
              </div>
              <div aria-label="Parts">{preview}</div>
            </>
          )}

          {mode === "AMOUNT" && (
            <div aria-label="Parts" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {amounts.map((amount, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ width: 60, fontSize: 13.5 }}>Part {i + 1}</span>
                  <input
                    aria-label={`Part ${i + 1} amount`}
                    inputMode="decimal"
                    placeholder="e.g. 5000"
                    value={amount}
                    onChange={(event) => setAmounts((current) => current.map((a, j) => (j === i ? event.target.value : a)))}
                    style={{ ...field, flex: 1 }}
                  />
                  <button
                    type="button"
                    aria-label={`Remove part ${i + 1}`}
                    disabled={amounts.length === 1}
                    onClick={() => setAmounts((current) => current.filter((_, j) => j !== i))}
                    style={{ border: "none", background: "none", color: COLORS.slateMid, cursor: amounts.length === 1 ? "not-allowed" : "pointer", opacity: amounts.length === 1 ? 0.4 : 1, display: "flex" }}
                  >
                    <X size={16} strokeWidth={1.8} />
                  </button>
                </div>
              ))}
              {preview}
              <button
                type="button"
                disabled={amounts.length + 1 >= MAX_BILL_PARTS}
                onClick={() => setAmounts((current) => [...current, ""])}
                style={{ alignSelf: "flex-start", height: 32, padding: "0 12px", border: `1px solid ${COLORS.borderStrong}`, borderRadius: 8, background: "#fff", color: COLORS.tealDark, fontSize: 13, fontWeight: 600, cursor: "pointer" }}
              >
                + Add a part
              </button>
            </div>
          )}

          {mode === "ITEMS" && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 13.5 }}>
                Between
                <Stepper value={guests} min={2} max={MAX_BILL_PARTS} label="Guests" onChange={setGuests} />
                guests
                <span style={{ marginLeft: "auto", fontSize: 12, color: COLORS.slateMid }}>Tap a guest to give them everything left.</span>
              </div>
              <div style={{ overflowX: "auto" }}>
                <div
                  aria-label="Assign items"
                  style={{ display: "grid", gridTemplateColumns: `minmax(150px, 1fr) repeat(${guests}, 92px)`, alignItems: "center", rowGap: 0, minWidth: "fit-content" }}
                >
                  <span style={{ fontSize: 12, color: COLORS.slateMid, padding: "6px 0" }}>Item</span>
                  {Array.from({ length: guests }, (_, g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => giveRest(g)}
                      title={`Give Guest ${g + 1} everything not yet assigned`}
                      style={{ height: 28, margin: "0 4px", border: `1px solid ${COLORS.borderStrong}`, borderRadius: 7, background: "#fff", fontSize: 12, fontWeight: 600, color: COLORS.tealDark, cursor: "pointer" }}
                    >
                      Guest {g + 1}
                    </button>
                  ))}
                  {bill.lines.map((line) => {
                    const left = line.quantity - assignedCount(line.id);
                    return (
                      <div key={line.id} data-split-line={line.name} style={{ display: "contents" }}>
                        <span style={{ padding: "8px 0", borderTop: `1px solid ${R.rowBorder}`, display: "flex", flexDirection: "column", gap: 2 }}>
                          <span style={{ fontSize: 13.5, fontWeight: 600 }}>
                            {line.quantity}× {line.name}
                          </span>
                          <span style={{ fontSize: 11.5, color: left === 0 ? COLORS.slateMid : COLORS.danger }}>{left === 0 ? "All assigned" : `${left} left`}</span>
                        </span>
                        {Array.from({ length: guests }, (_, g) => {
                          const value = unitsOf(line.id)[g] ?? 0;
                          return (
                            <span key={g} style={{ borderTop: `1px solid ${R.rowBorder}`, padding: "8px 0", display: "flex", justifyContent: "center" }}>
                              <Stepper value={value} min={0} max={value + left} label={`${line.name} for Guest ${g + 1}`} onChange={(n) => setUnits(line.id, g, n)} />
                            </span>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>

        {(bill.settleBlocker ?? problem) && (
          <p role="alert" style={{ margin: 0, fontSize: 13, color: COLORS.danger }}>
            {bill.settleBlocker ?? problem}
          </p>
        )}
        <button
          type="button"
          onClick={submit}
          disabled={!ready}
          style={{ height: 44, border: "none", borderRadius: 9, background: ready ? COLORS.teal : COLORS.slateLight, color: "#fff", fontSize: 14, fontWeight: 600, cursor: ready ? "pointer" : "not-allowed" }}
        >
          {saving ? "Splitting…" : "Split the bill"}
        </button>
      </div>
    </div>
  );
}
