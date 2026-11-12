"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { LINE_STATUS_LABEL } from "../../lib/orderLines";
import { shortPrice } from "../../lib/optionFlow";
import { placeLabel } from "../../lib/posSpeed";
import { TOUCH } from "../../lib/theme";
import type { OrderScreenData, TicketLine } from "../../server/queries/orderScreen";
import TouchButton from "./TouchButton";

// A dish tapped a moment ago, on the check before the server has it (with
// the options, quantity, seat and course picked for it).
export type PendingLine = { key: string; name: string; price: string; options: string[]; quantity: number; place: string };

const COLUMNS = "44px minmax(0,1fr) minmax(100px,auto)";
const money = { fontFamily: TOUCH.mono, fontVariantNumeric: "tabular-nums", textAlign: "right", whiteSpace: "nowrap" } as const;

type Tag = { label: string; colors: readonly [string, string] };

function tagOf(line: TicketLine): Tag {
  if (line.cancelled) return { label: "VOID", colors: TOUCH.tag.VOID };
  if (line.held) return { label: "HOLD", colors: TOUCH.tag.HOLD };
  if (line.kitchenStatus === "NEW") return { label: "NEW", colors: TOUCH.tag.NEW };
  if (line.kitchenStatus === "READY") return { label: "READY", colors: TOUCH.tag.READY };
  if (line.kitchenStatus === "PENDING") return { label: "SENT", colors: TOUCH.tag.SENT };
  return { label: LINE_STATUS_LABEL[line.kitchenStatus].toUpperCase(), colors: TOUCH.tag.SENT };
}

function Row({
  rowKey,
  state,
  quantity,
  name,
  options,
  note,
  info,
  amount,
  tag,
  selected,
  onTap,
}: {
  rowKey: string;
  state: "new" | "sent" | "void" | "pending";
  quantity: number;
  name: string;
  // Each option on its own line, indented under the dish; the note last.
  options: string[];
  note: string | null;
  // Beside the tag: "Seat 1 · 19:31 · Kitchen".
  info: string;
  amount: string;
  tag: Tag;
  selected: boolean;
  onTap?: () => void;
}) {
  const struck = state === "void";
  const ink = struck ? TOUCH.tag.VOID[1] : TOUCH.ink;
  return (
    <button
      type="button"
      data-key={rowKey}
      data-check-line={name}
      data-state={state}
      aria-pressed={selected}
      onClick={onTap}
      disabled={!onTap}
      style={{
        display: "grid",
        gridTemplateColumns: COLUMNS,
        gap: 8,
        width: "100%",
        textAlign: "left",
        padding: "9px 14px",
        border: "none",
        borderBottom: `1px solid ${TOUCH.ruleSoft}`,
        background: selected ? TOUCH.selectedLine : state === "new" || state === "pending" ? TOUCH.unsentBg : TOUCH.check,
        boxShadow: selected ? `inset 4px 0 0 ${TOUCH.teal}` : "none",
        color: ink,
        font: "inherit",
        cursor: onTap ? "pointer" : "default",
        opacity: state === "pending" ? 0.75 : 1,
        touchAction: "manipulation",
      }}
    >
      <span style={{ fontFamily: TOUCH.display, fontSize: 17, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{quantity}</span>
      <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <span style={{ fontSize: 15, fontWeight: 600, overflowWrap: "anywhere", textDecoration: struck ? "line-through" : "none" }}>{name}</span>
        {(options.length > 0 || note) && (
          <span data-line-options style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {options.map((option, i) => (
              <span key={`${option}-${i}`} data-line-option={option} style={{ fontSize: 13, color: TOUCH.inkDim, paddingLeft: 10, overflowWrap: "anywhere" }}>
                {option}
              </span>
            ))}
            {note && (
              <span data-line-note style={{ fontSize: 13, color: TOUCH.inkDim, paddingLeft: 10, overflowWrap: "anywhere" }}>
                » {note}
              </span>
            )}
          </span>
        )}
        <span style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 3, flexWrap: "wrap" }}>
          <span data-line-tag style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".06em", padding: "2px 6px", borderRadius: 3, background: tag.colors[0], color: tag.colors[1] }}>{tag.label}</span>
          {info && (
            <span data-line-place style={{ fontSize: 12, color: TOUCH.inkFaint }}>
              {info}
            </span>
          )}
        </span>
      </span>
      <span style={{ ...money, fontSize: 15, fontWeight: 600, textDecoration: struck ? "line-through" : "none" }}>{amount}</span>
    </button>
  );
}

function TotalRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 14, color: TOUCH.inkDim }}>
      <span>{label}</span>
      <span style={money}>{value}</span>
    </div>
  );
}

// The line picked on the check: − / its quantity / + / Repeat / Seat — white
// keys on a grey strip under the lines (the Restaurant POS design).
export function LineStrip({
  name,
  quantity,
  seat,
  canStepDown,
  onStep,
  onRepeat,
  onSeat,
}: {
  name: string;
  quantity: number;
  seat: number | null;
  canStepDown: boolean;
  onStep: (by: 1 | -1) => void;
  onRepeat: () => void;
  onSeat: () => void;
}) {
  const key = { height: 48, boxShadow: `inset 0 0 0 1px ${TOUCH.stripEdge}`, color: TOUCH.ink } as const;
  return (
    <div data-line-actions style={{ display: "grid", gridTemplateColumns: "56px 56px 56px minmax(0,1fr) minmax(0,1fr)", gap: 4, padding: 6, background: TOUCH.strip, borderTop: `1px solid ${TOUCH.rule}` }}>
      <TouchButton data-line-action="−1" aria-label={`One fewer ${name}`} background={TOUCH.check} color={TOUCH.ink} pressedBackground={TOUCH.rule} onClick={() => onStep(-1)} style={{ ...key, fontSize: 24, fontWeight: 600, opacity: canStepDown ? 1 : 0.45 }}>
        −
      </TouchButton>
      <span data-line-quantity style={{ height: 48, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: TOUCH.display, fontSize: 20, fontWeight: 700, color: TOUCH.ink }}>
        {quantity}
      </span>
      <TouchButton data-line-action="+1" aria-label={`One more ${name}`} background={TOUCH.check} color={TOUCH.ink} pressedBackground={TOUCH.rule} onClick={() => onStep(1)} style={{ ...key, fontSize: 24, fontWeight: 600 }}>
        +
      </TouchButton>
      <TouchButton data-line-action="Repeat" aria-label={`Repeat ${name}`} background={TOUCH.check} color={TOUCH.ink} pressedBackground={TOUCH.rule} onClick={onRepeat} style={{ ...key, fontSize: 15, fontWeight: 600 }}>
        Repeat
      </TouchButton>
      <TouchButton data-line-action="Seat" aria-label={`Seat for ${name}`} background={TOUCH.check} color={TOUCH.ink} pressedBackground={TOUCH.rule} onClick={onSeat} style={{ ...key, fontSize: 15, fontWeight: 600 }}>
        {seat ? `Seat ${seat}` : "Seat –"}
      </TouchButton>
    </div>
  );
}

// The touch POS's check (left, white — the Restaurant POS design): "Check ·
// 3 lines · opened 19:24", then one row per line — quantity, name, amount,
// its options indented beneath, its tag (NEW / SENT / HOLD / VOID) with its
// seat, when it went and where — unsent lines cream, the picked one teal.
// The newest line is scrolled into view. Money is the server's: while a
// change is on its way the totals dim.
export default function CheckPanel({
  lines,
  pending,
  totals,
  busy,
  highlightKey,
  selectedId,
  onSelect,
  opened,
  banner,
  lineActions,
  empty,
}: {
  lines: TicketLine[];
  pending: PendingLine[];
  totals: OrderScreenData["totals"] | null;
  busy: boolean;
  highlightKey: string | null;
  selectedId: string | null;
  onSelect: (lineId: string) => void;
  // "19:24" (none: no order).
  opened?: string;
  // Above the lines: the Ready bar, held courses, a closed order's note.
  banner?: ReactNode;
  // Under the lines, while one is picked: LineStrip.
  lineActions?: ReactNode;
  // Shown when there are no lines.
  empty: ReactNode;
}) {
  const list = useRef<HTMLDivElement>(null);

  // The newest line in view (the list is the only thing that scrolls).
  useEffect(() => {
    if (!highlightKey) return;
    const row = list.current?.querySelector(`[data-key="${CSS.escape(highlightKey)}"]`);
    row?.scrollIntoView({ block: "nearest" });
  }, [highlightKey, lines.length, pending.length]);

  const live = lines.filter((line) => !line.cancelled).length + pending.length;
  const unsent = lines.filter((line) => line.editable).length + pending.length;
  const meta = opened ? `${live} line${live === 1 ? "" : "s"} · opened ${opened}` : null;

  return (
    <section aria-label="Check" data-pos-check style={{ background: TOUCH.check, color: TOUCH.ink, borderRadius: TOUCH.radius, display: "flex", flexDirection: "column", minHeight: 0, minWidth: 0, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, padding: "10px 14px 8px", borderBottom: `2px solid ${TOUCH.ink}` }}>
        <span style={{ fontFamily: TOUCH.display, fontSize: 18, fontWeight: 700 }}>Check</span>
        {meta && (
          <span data-check-meta style={{ fontSize: 13, color: TOUCH.inkDim }}>
            {meta}
          </span>
        )}
      </div>
      <div aria-hidden style={{ display: "grid", gridTemplateColumns: COLUMNS, gap: 8, padding: "6px 14px", fontSize: 11, fontWeight: 700, letterSpacing: ".06em", color: TOUCH.inkFaint, borderBottom: `1px solid ${TOUCH.rule}` }}>
        <span>QTY</span>
        <span>ITEM</span>
        <span style={{ textAlign: "right" }}>AMOUNT</span>
      </div>
      {banner}
      <div ref={list} aria-label="Check lines" style={{ flex: 1, overflowY: "auto", overscrollBehavior: "contain", minHeight: 0 }}>
        {lines.length === 0 && pending.length === 0 ? (
          <div style={{ padding: "18px 14px", fontSize: 15, color: TOUCH.inkDim }}>{empty}</div>
        ) : (
          <>
            {lines.map((line) => (
              <Row
                key={line.id}
                rowKey={line.id}
                state={line.cancelled ? "void" : line.kitchenStatus === "NEW" ? "new" : "sent"}
                quantity={line.quantity}
                name={line.remake ? `${line.name} (remake)` : line.name}
                options={line.options}
                note={line.note}
                info={[placeLabel(line.seat, line.course), line.cancelled ? (line.cancelReason ?? "") : [line.sentAt, line.station].filter(Boolean).join(" · ")].filter(Boolean).join(" · ")}
                amount={line.remake ? "No charge" : shortPrice(line.amount)}
                tag={tagOf(line)}
                selected={selectedId === line.id}
                onTap={() => onSelect(line.id)}
              />
            ))}
            {pending.map((line) => (
              <Row
                key={line.key}
                rowKey={line.key}
                state="pending"
                quantity={line.quantity}
                name={line.name}
                options={line.options}
                note={null}
                info={line.place}
                amount={shortPrice(line.price)}
                tag={{ label: "NEW", colors: TOUCH.tag.NEW }}
                selected={false}
              />
            ))}
          </>
        )}
      </div>
      {lineActions}
      {totals && (
        <div aria-label="Totals" aria-busy={busy} style={{ padding: "8px 14px 10px", borderTop: `1px solid ${TOUCH.rule}`, display: "flex", flexDirection: "column", gap: 3, opacity: busy ? 0.45 : 1 }}>
          <TotalRow label="Subtotal" value={totals.subTotal} />
          {totals.discount && <TotalRow label={`Discount (${totals.discount.label})`} value={totals.discount.amount} />}
          {totals.servicePercent !== "off" && <TotalRow label={`Service ${totals.servicePercent}`} value={totals.serviceCharge} />}
          <TotalRow label={totals.taxLabel} value={totals.tax} />
          <div data-pos-total style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, marginTop: 4 }}>
            <span style={{ fontFamily: TOUCH.display, fontSize: 18, fontWeight: 700 }}>Total</span>
            <span style={{ fontFamily: TOUCH.display, fontSize: 28, fontWeight: 700, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{totals.total}</span>
          </div>
          {live > 0 && (
            <span data-unsent style={{ fontSize: 13, fontWeight: 600, color: unsent ? TOUCH.unsentInk : TOUCH.allSent }}>
              {unsent ? `${unsent} line${unsent === 1 ? "" : "s"} not sent` : "All lines sent"}
            </span>
          )}
        </div>
      )}
    </section>
  );
}
