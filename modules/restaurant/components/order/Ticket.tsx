"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Pencil } from "lucide-react";
import type { OrderType } from "@prisma/client";
import { COLORS, FONTS } from "@/components/layout/theme";
import { MAX_LINE_QUANTITY } from "../../lib/modifiers";
import { LINE_STATUS_LABEL, MAX_GUESTS, ORDER_TYPE_LABEL } from "../../lib/orderLines";
import { LINE_STATUS_PILL, R } from "../../lib/theme";
import type { OrderDetailsChange } from "../../schemas/order";
import { updateOrderDetails } from "../../server/actions/orders";
import type { OrderScreenData, TicketLine } from "../../server/queries/orderScreen";
import type { OrderChangeResult } from "../../server/services/orders";
import type { Pending } from "./OrderScreen";
import ReadyToServe from "./ReadyToServe";
import PrintButton from "@/components/hardware/PrintButton";
import { printReceiptAction } from "../../server/actions/printing";

const ORDER_TYPES: OrderType[] = ["DINE_IN", "TAKEAWAY", "DELIVERY"];

function HeaderSelect({
  label,
  value,
  onChange,
  disabled,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  children: ReactNode;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      style={{
        height: 34,
        minWidth: 0,
        border: `1px solid ${COLORS.borderStrong}`,
        borderRadius: 7,
        padding: "0 8px",
        fontSize: 12.5,
        background: "#fff",
        color: COLORS.ink,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {children}
    </select>
  );
}

function LinePill({ line }: { line: TicketLine }) {
  const key = line.cancelled ? "CANCELLED" : line.kitchenStatus;
  const [background, color] = LINE_STATUS_PILL[key];
  return (
    <span
      title={line.cancelled && line.cancelReason ? `Cancelled: ${line.cancelReason}` : undefined}
      style={{ height: 22, padding: "0 8px", borderRadius: 11, background, color, fontSize: 11, fontWeight: 600, display: "flex", alignItems: "center" }}
    >
      {line.cancelled ? "Cancelled" : LINE_STATUS_LABEL[line.kitchenStatus]}
    </span>
  );
}

const stepButton = (disabled: boolean) =>
  ({
    width: 30,
    height: 28,
    border: "none",
    background: "#fff",
    cursor: disabled ? "not-allowed" : "pointer",
    fontSize: 15,
    color: disabled ? COLORS.slateLight : COLORS.slate,
  }) as const;

// A New line's controls: the pencil (options / note) and the 1-99 stepper;
// below 1 the line goes.
function LineControls({
  line,
  quantity,
  onStep,
  onEdit,
}: {
  line: TicketLine;
  quantity: number;
  onStep: (delta: 1 | -1) => void;
  onEdit: () => void;
}) {
  return (
    <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
      <button
        type="button"
        title="Change options or note"
        aria-label={`Change ${line.name}`}
        onClick={onEdit}
        style={{ width: 28, height: 28, border: `1px solid ${COLORS.borderStrong}`, borderRadius: 7, background: "#fff", color: COLORS.slate, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
      >
        <Pencil size={13} strokeWidth={1.8} />
      </button>
      <span style={{ display: "flex", alignItems: "center", border: `1px solid ${COLORS.borderStrong}`, borderRadius: 7, overflow: "hidden" }}>
        <button type="button" aria-label={`One less ${line.name}`} onClick={() => onStep(-1)} style={stepButton(false)}>
          −
        </button>
        <span aria-label="Quantity" style={{ width: 30, textAlign: "center", fontFamily: FONTS.mono, fontSize: 13 }}>
          {quantity}
        </span>
        <button
          type="button"
          aria-label={`One more ${line.name}`}
          disabled={quantity >= MAX_LINE_QUANTITY}
          onClick={() => onStep(1)}
          style={stepButton(quantity >= MAX_LINE_QUANTITY)}
        >
          +
        </button>
      </span>
    </span>
  );
}

const smallButton = (color: string, border: string) =>
  ({
    height: 28,
    padding: "0 10px",
    border: `1px solid ${border}`,
    borderRadius: 7,
    background: "#fff",
    color,
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  }) as const;

// A sent line's controls: Served (once the kitchen has it Ready) and Cancel.
function SentLineControls({ line, onServe, onCancel }: { line: TicketLine; onServe: () => void; onCancel: () => void }) {
  return (
    <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontFamily: FONTS.mono, fontSize: 13, color: COLORS.slate }}>× {line.quantity}</span>
      {line.canServe && (
        <button type="button" aria-label={`Mark ${line.name} served`} onClick={onServe} style={smallButton(COLORS.tealDark, COLORS.teal)}>
          Served
        </button>
      )}
      {line.canCancel && (
        <button type="button" aria-label={`Cancel ${line.name}`} onClick={onCancel} style={smallButton(COLORS.danger, COLORS.borderStrong)}>
          Cancel
        </button>
      )}
    </span>
  );
}

function TotalRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5, color: COLORS.slate }}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function FooterButton({
  children,
  primary,
  disabledReason,
  onClick,
}: {
  children: ReactNode;
  primary?: boolean;
  disabledReason?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!!disabledReason}
      title={disabledReason}
      style={{
        height: 46,
        border: primary ? "none" : `1px solid ${COLORS.teal}`,
        background: primary ? COLORS.teal : "#fff",
        color: primary ? "#fff" : COLORS.tealDark,
        borderRadius: 9,
        fontSize: 14,
        fontWeight: 600,
        cursor: disabledReason ? "not-allowed" : "pointer",
        opacity: disabledReason ? 0.55 : 1,
      }}
    >
      {children}
    </button>
  );
}

type Header = { type: OrderType; waiterId: string; guests: number };

// The order screen's right side (Table Order design): the table, reference
// and time open; type / waiter / guests (each saved as soon as it changes);
// the lines with their state — the pencil and stepper on New lines, Served
// and Cancel on sent ones; the totals; Send to kitchen and Cancel order.
// Money is only ever the server's: while a change is on its way the amounts
// dim until the server's new ones arrive.
export default function Ticket({
  data,
  run,
  busy,
  shownQuantity,
  onStep,
  onEdit,
  onSend,
  onServe,
  onServeReady,
  onCancelLine,
  onCancelOrder,
  onBill,
  onRefund,
  receiptPrinter,
}: {
  data: OrderScreenData;
  run: (change: (version: number) => Promise<OrderChangeResult>) => Promise<boolean>;
  busy: boolean;
  shownQuantity: (line: TicketLine) => number;
  onStep: (line: TicketLine, delta: 1 | -1) => void;
  onEdit: (line: TicketLine) => void;
  onSend: () => void;
  onServe: (line: TicketLine) => void;
  onServeReady: (lines: TicketLine[]) => void;
  onCancelLine: (line: TicketLine) => void;
  onCancelOrder: () => void;
  onBill: () => void;
  // A settled bill, and the user can give refunds (Settle Bill).
  onRefund?: () => void;
  // Where Print receipt goes (null: the browser's print page).
  receiptPrinter: string | null;
}) {
  const { order, lines, totals, newCount, waiters } = data;
  const server: Header = { type: order.type, waiterId: order.waiterId ?? "", guests: order.guests };
  const [header, setHeader] = useState<{ [K in keyof Header]?: Pending<Header[K]> }>({});
  const value = <K extends keyof Header>(field: K): Header[K] => {
    const pending = header[field];
    return pending && pending.base === server[field] ? pending.value : server[field];
  };
  const shown: Header = { type: value("type"), waiterId: value("waiterId"), guests: value("guests") };
  const locked = !order.editable;

  function save(change: OrderDetailsChange) {
    setHeader((current) => ({ ...current, [change.field]: { value: change.value, base: server[change.field] } }));
    void run((version) => updateOrderDetails({ orderId: order.id, version, change })).then((accepted) => {
      if (!accepted) setHeader((current) => ({ ...current, [change.field]: undefined }));
    });
  }

  const title = order.tableName ? `Table ${order.tableName}` : ORDER_TYPE_LABEL[order.type];
  // A line stepped down to 0 disappears at once (it's removed on the server).
  const visible = lines.filter((line) => shownQuantity(line) > 0);

  return (
    <aside
      aria-label="Ticket"
      style={{ background: "#fff", borderLeft: `1px solid ${COLORS.border}`, display: "flex", flexDirection: "column", minHeight: 0 }}
    >
      <div style={{ padding: "16px 20px", borderBottom: `1px solid ${COLORS.border}`, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h1 style={{ margin: 0, fontFamily: FONTS.display, fontSize: 22, fontWeight: 600 }}>{title}</h1>
          <span style={{ fontFamily: FONTS.mono, fontSize: 12, color: COLORS.slateMid }}>
            {order.ref} · {order.open}
          </span>
          {order.editable && (
            <button
              type="button"
              onClick={onCancelOrder}
              disabled={!!order.cancelBlocker}
              title={order.cancelBlocker ?? "Cancel this order and free the table"}
              style={{
                marginLeft: "auto",
                border: "none",
                background: "none",
                padding: 0,
                fontSize: 12.5,
                fontWeight: 600,
                color: order.cancelBlocker ? COLORS.slateLight : COLORS.danger,
                cursor: order.cancelBlocker ? "not-allowed" : "pointer",
              }}
            >
              Cancel order
            </button>
          )}
          {!order.editable && (
            <span style={{ marginLeft: "auto", height: 22, padding: "0 9px", borderRadius: 11, background: COLORS.bgApp, color: COLORS.slate, fontSize: 11.5, fontWeight: 600, display: "flex", alignItems: "center" }}>
              {order.status === "BILLED" ? "Billed" : "Cancelled"}
            </span>
          )}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          <HeaderSelect label="Order type" value={shown.type} disabled={locked} onChange={(value) => save({ field: "type", value: value as OrderType })}>
            {ORDER_TYPES.map((type) => (
              <option key={type} value={type} disabled={type === "DINE_IN" && !order.tableName}>
                {ORDER_TYPE_LABEL[type]}
              </option>
            ))}
          </HeaderSelect>
          <HeaderSelect label="Waiter" value={shown.waiterId} disabled={locked} onChange={(value) => save({ field: "waiterId", value })}>
            {!shown.waiterId && <option value="">Waiter: —</option>}
            {waiters.map((w) => (
              <option key={w.id} value={w.id}>
                Waiter: {w.name}
              </option>
            ))}
          </HeaderSelect>
          <HeaderSelect label="Guests" value={String(shown.guests)} disabled={locked} onChange={(value) => save({ field: "guests", value: Number(value) })}>
            {/* A merge can add guests past the select's usual 30. */}
            {Array.from({ length: Math.max(MAX_GUESTS, shown.guests) }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n} {n === 1 ? "guest" : "guests"}
              </option>
            ))}
          </HeaderSelect>
        </div>
      </div>

      <ReadyToServe lines={lines} busy={busy} onServe={onServeReady} />
      <div aria-label="Order lines" style={{ flex: 1, overflowY: "auto", padding: "8px 20px" }}>
        {visible.length === 0 ? (
          <p style={{ margin: "12px 0", fontSize: 13.5, color: COLORS.slateMid }}>No items yet. Tap a dish to add it.</p>
        ) : (
          visible.map((line) => (
            <div key={line.id} data-line={line.name} style={{ padding: "12px 0", borderBottom: `1px solid ${R.rowBorder}`, display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600, textDecoration: line.cancelled ? "line-through" : "none", color: line.cancelled ? COLORS.slateMid : COLORS.ink }}>
                    {line.name}
                    {line.remake && (
                      <span data-remake style={{ marginLeft: 8, padding: "1px 7px", borderRadius: 10, background: "#fff4e0", color: "#8a5a00", fontSize: 11, fontWeight: 600, textDecoration: "none", display: "inline-block" }}>
                        Remake
                      </span>
                    )}
                  </span>
                  {line.detail && <span style={{ fontSize: 12, color: COLORS.slateMid }}>{line.detail}</span>}
                </div>
                <span
                  aria-label="Amount"
                  style={{
                    fontWeight: 600,
                    fontSize: 13.5,
                    textDecoration: line.cancelled ? "line-through" : "none",
                    color: line.cancelled ? COLORS.slateMid : COLORS.ink,
                    opacity: shownQuantity(line) !== line.quantity ? 0.4 : 1,
                  }}
                >
                  {line.remake ? "No charge" : line.amount}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <LinePill line={line} />
                {line.editable ? (
                  <LineControls line={line} quantity={shownQuantity(line)} onStep={(delta) => onStep(line, delta)} onEdit={() => onEdit(line)} />
                ) : (
                  <SentLineControls line={line} onServe={() => onServe(line)} onCancel={() => onCancelLine(line)} />
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <div aria-label="Totals" aria-busy={busy} style={{ padding: "16px 20px", borderTop: `1px solid ${COLORS.border}`, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, opacity: busy ? 0.4 : 1, transition: "opacity .15s" }}>
          <TotalRow label="Sub total" value={totals.subTotal} />
          {totals.discount && <TotalRow label={`Discount (${totals.discount.label})`} value={totals.discount.amount} />}
          <TotalRow label={`Service charge (${totals.servicePercent})`} value={totals.serviceCharge} />
          <TotalRow label={totals.taxLabel} value={totals.tax} />
          <div style={{ display: "flex", justifyContent: "space-between", fontFamily: FONTS.display, fontSize: 20, fontWeight: 600, paddingTop: 4 }}>
            <span>Total</span>
            <span>{totals.total}</span>
          </div>
        </div>
        {order.editable ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 6 }}>
            <FooterButton onClick={onSend} disabledReason={newCount === 0 ? "Nothing new to send" : busy ? "Saving…" : undefined}>
              Send to kitchen ({newCount})
            </FooterButton>
            <FooterButton primary onClick={onBill} disabledReason={busy ? "Saving…" : undefined}>
              Bill &amp; pay
            </FooterButton>
          </div>
        ) : order.saleId ? (
          <>
          <div style={{ display: "grid", gridTemplateColumns: onRefund ? "1fr 1fr 1fr" : "1fr 1fr", gap: 8, marginTop: 6 }}>
            <Link
              href={`/sales/${order.saleId}`}
              style={{ height: 46, display: "flex", alignItems: "center", justifyContent: "center", border: `1px solid ${COLORS.teal}`, borderRadius: 9, color: COLORS.tealDark, fontSize: 14, fontWeight: 600, textDecoration: "none" }}
            >
              View sale
            </Link>
            <PrintButton
              printer={receiptPrinter}
              href={`/restaurant/receipt/${order.saleId}`}
              onQueue={() => printReceiptAction(order.saleId!)}
              style={{ height: 46, border: "none", display: "flex", alignItems: "center", justifyContent: "center", background: COLORS.teal, borderRadius: 9, color: "#fff", fontSize: 14, fontWeight: 600, textDecoration: "none" }}
            >
              Print receipt
            </PrintButton>
            {onRefund && (
              <button
                type="button"
                onClick={onRefund}
                style={{ height: 46, border: `1px solid ${COLORS.danger}`, borderRadius: 9, background: "#fff", color: COLORS.danger, fontSize: 14, fontWeight: 600, cursor: "pointer" }}
              >
                Refund
              </button>
            )}
          </div>
          <p data-settled-note style={{ margin: "2px 0 0", fontSize: 12, color: COLORS.slateMid }}>
            A settled bill can&apos;t be reopened — corrections are refunds against its sale.
          </p>
          </>
        ) : (
          <p style={{ margin: "6px 0 0", fontSize: 13, color: COLORS.slateMid }}>
            {order.status === "CANCELLED" ? `Cancelled${order.cancelReason ? ` — ${order.cancelReason}` : ""}.` : "Billed."} This order can no longer be changed.
          </p>
        )}
      </div>
    </aside>
  );
}
