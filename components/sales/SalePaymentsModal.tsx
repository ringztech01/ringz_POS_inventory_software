"use client";

import { useCallback, useEffect, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Trash2 } from "lucide-react";
import type { PaymentType } from "@prisma/client";
import { useToggleState } from "@/components/layout/hooks";
import { COLORS, FONTS } from "@/components/layout/theme";
import MasterDataModal from "@/components/ui/MasterDataModal";
import { DateInput, DecimalInput, Field, SelectInput } from "@/components/purchases/form-fields";
import { PAYMENT_TYPE_LABELS, PaymentStatusPill } from "@/components/purchases/purchase-display";
import { formatDateOnly, formatNaira } from "@/lib/format";
import { toDecimal } from "@/lib/pricing";
import {
  addSalePayment,
  deleteSalePayment,
  getSalePayments,
  type SalePaymentFieldName,
  type SalePaymentsView,
} from "@/app/(dashboard)/sales/actions";
import {
  addSaleReturnRefund,
  deleteSaleReturnRefund,
  getSaleReturnRefunds,
} from "@/app/(dashboard)/sales/returns/actions";

// What the modal manages: a sale's payments, or a sale return's refunds to
// the customer (SaleReturnPayment). Same UI and rules; different actions and
// words.
const KINDS = {
  sale: {
    load: getSalePayments,
    add: addSalePayment,
    remove: deleteSalePayment,
    title: "Payments",
    word: "payment",
    paidLabel: "Paid",
    dueLabel: "Due",
    dueWord: "amount due",
    settled: "This sale is fully paid.",
    missing: "This sale no longer exists.",
  },
  saleReturn: {
    load: getSaleReturnRefunds,
    add: addSaleReturnRefund,
    remove: deleteSaleReturnRefund,
    title: "Refunds",
    word: "refund",
    paidLabel: "Refunded",
    dueLabel: "Refund due",
    dueWord: "refund due",
    settled: "This return is fully refunded.",
    missing: "This sale return no longer exists.",
  },
} as const;

const HISTORY_GRID = "100px 120px 110px minmax(0,1fr) 34px";

const overline = {
  fontSize: 11.5,
  fontWeight: 600,
  letterSpacing: ".08em",
  textTransform: "uppercase",
  color: COLORS.slateMid,
} as const;

function todayInputValue(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function SummaryItem({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
      <span style={overline}>{label}</span>
      <span style={{ fontFamily: FONTS.mono, fontSize: 13.5, fontWeight: strong ? 600 : 500, color: COLORS.ink }}>
        {value}
      </span>
    </div>
  );
}

// Two clicks: the first arms it ("Confirm"), the second deletes.
function DeletePaymentButton({ word, onDelete, disabled }: { word: string; onDelete: () => void; disabled?: boolean }) {
  const [armed, setArmed] = useState(false);
  const hover = useToggleState();

  return (
    <button
      type="button"
      title={armed ? `Click again to delete this ${word}` : `Delete ${word}`}
      aria-label={armed ? `Confirm delete ${word}` : `Delete ${word}`}
      disabled={disabled}
      onClick={() => (armed ? onDelete() : setArmed(true))}
      onMouseEnter={hover.on}
      onMouseLeave={() => {
        hover.off();
        setArmed(false);
      }}
      style={{
        justifySelf: "end",
        width: armed ? "auto" : 30,
        height: 30,
        padding: armed ? "0 8px" : 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: armed || hover.value ? COLORS.dangerBg : "#fff",
        border: `1px solid ${armed || hover.value ? COLORS.dangerBorder : COLORS.borderStrong}`,
        borderRadius: 6,
        cursor: disabled ? "not-allowed" : "pointer",
        color: armed || hover.value ? COLORS.danger : COLORS.slate,
        fontSize: 12,
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      {armed ? "Confirm" : <Trash2 size={14} strokeWidth={1.8} />}
    </button>
  );
}

// "Show Payments" for a sale, "Record refund" for a sale return. No design of
// its own — built on the shared modal shell (as the Categories modal is).
// Every add/delete goes through server actions that recompute
// paid/due/status with computePaymentState.
export default function SalePaymentsModal({
  documentId,
  kind = "sale",
  onClose,
}: {
  documentId: string;
  kind?: keyof typeof KINDS;
  onClose: () => void;
}) {
  const k = KINDS[kind];
  const router = useRouter();
  const [view, setView] = useState<SalePaymentsView | null | undefined>(undefined);
  const [amount, setAmount] = useState("");
  const [paymentType, setPaymentType] = useState<PaymentType>("CASH");
  const [date, setDate] = useState(todayInputValue());
  const [notes, setNotes] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<SalePaymentFieldName, string[]>>>({});
  const [isPending, startTransition] = useTransition();
  const notesFocus = useToggleState();

  const load = useCallback(async () => {
    setView(await k.load(documentId));
  }, [k, documentId]);

  useEffect(() => {
    let cancelled = false;
    k.load(documentId).then((result) => {
      if (!cancelled) setView(result);
    });
    return () => {
      cancelled = true;
    };
  }, [k, documentId]);

  const due = view ? toDecimal(view.due) : toDecimal(0);
  const fullyPaid = !!view && due.isZero();
  const amountExceedsDue = !!view && toDecimal(amount).greaterThan(due);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!view || isPending || fullyPaid) return;
    setFieldErrors({});

    startTransition(async () => {
      const result = await k.add(documentId, { amount, paymentType, date, notes });
      if (result.ok) {
        toast.success(kind === "sale" ? "Payment added." : "Refund recorded.");
        setAmount("");
        setNotes("");
        await load();
        router.refresh();
      } else {
        setFieldErrors(result.fieldErrors ?? {});
        toast.error(result.error ?? "Something went wrong.");
      }
    });
  }

  function handleDelete(paymentId: string) {
    startTransition(async () => {
      const result = await k.remove(paymentId);
      if (result.ok) {
        toast.success(kind === "sale" ? "Payment deleted." : "Refund deleted.");
        await load();
        router.refresh();
      } else {
        toast.error(result.error ?? "Something went wrong.");
      }
    });
  }

  const errorOf = (field: SalePaymentFieldName) => fieldErrors[field]?.[0];

  return (
    <MasterDataModal
      title={k.title}
      onClose={onClose}
      onSubmit={handleSubmit}
      submitting={isPending}
      submitLabel={kind === "sale" ? "Add payment" : "Record refund"}
      submitDisabled={!view || fullyPaid || amountExceedsDue}
      width={600}
    >
      {view === undefined && <span style={{ fontSize: 13.5, color: COLORS.slateMid }}>Loading…</span>}
      {view === null && <span style={{ fontSize: 13.5, color: COLORS.danger }}>{k.missing}</span>}

      {view && (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0,1.3fr) repeat(3, minmax(0,1fr))",
              gap: 16,
              padding: "14px 16px",
              background: COLORS.bgInput,
              border: `1px solid ${COLORS.border}`,
              borderRadius: 10,
            }}
          >
            <SummaryItem label="Reference" value={view.reference} />
            <SummaryItem label="Grand total" value={formatNaira(view.grandTotal)} />
            <SummaryItem label={k.paidLabel} value={formatNaira(view.paid)} />
            <SummaryItem label={k.dueLabel} value={formatNaira(view.due)} strong />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={overline}>{k.word} history</span>
              <PaymentStatusPill paymentStatus={view.paymentStatus} />
            </div>
            <div style={{ border: `1px solid ${COLORS.border}`, borderRadius: 10, overflow: "hidden" }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: HISTORY_GRID,
                  columnGap: 12,
                  alignItems: "center",
                  padding: "0 14px",
                  height: 38,
                  background: COLORS.bgInput,
                  borderBottom: `1px solid ${COLORS.border}`,
                }}
              >
                {["Date", "Amount", "Type", "Notes", ""].map((label, i) => (
                  <span key={label || i} style={{ ...overline, fontSize: 10.5, textAlign: i === 1 ? "right" : "left" }}>
                    {label}
                  </span>
                ))}
              </div>
              {view.payments.length === 0 ? (
                <div style={{ padding: "16px 14px", fontSize: 13, color: COLORS.slateMid }}>No {k.word}s yet.</div>
              ) : (
                view.payments.map((payment) => (
                  <div
                    key={payment.id}
                    data-payment-row
                    style={{
                      display: "grid",
                      gridTemplateColumns: HISTORY_GRID,
                      columnGap: 12,
                      alignItems: "center",
                      padding: "0 14px",
                      minHeight: 44,
                      borderBottom: `1px solid ${COLORS.bgApp}`,
                    }}
                  >
                    <span style={{ fontFamily: FONTS.mono, fontSize: 12.5, color: COLORS.text }}>
                      {formatDateOnly(new Date(`${payment.date}T00:00:00.000Z`))}
                    </span>
                    <span style={{ fontFamily: FONTS.mono, fontSize: 13, fontWeight: 600, textAlign: "right" }}>
                      {formatNaira(payment.amount)}
                    </span>
                    <span style={{ fontSize: 13, color: COLORS.slate }}>{PAYMENT_TYPE_LABELS[payment.paymentType]}</span>
                    <span
                      style={{ fontSize: 13, color: COLORS.slate, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                      title={payment.notes ?? undefined}
                    >
                      {payment.notes || "—"}
                    </span>
                    <DeletePaymentButton word={k.word} disabled={isPending} onDelete={() => handleDelete(payment.id)} />
                  </div>
                ))
              )}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <span style={overline}>{kind === "sale" ? "Add payment" : "Record refund"}</span>
            {fullyPaid ? (
              <span style={{ fontSize: 13, color: COLORS.slateMid }}>{k.settled}</span>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: "16px 20px" }}>
                <Field
                  label="Amount"
                  required
                  error={
                    amountExceedsDue
                      ? `Amount can't be more than the ${k.dueWord} (${formatNaira(view.due)}).`
                      : errorOf("amount")
                  }
                >
                  <DecimalInput
                    value={amount}
                    onChange={setAmount}
                    suffix="₦"
                    ariaLabel="Amount"
                    autoFocus
                    hasError={amountExceedsDue || !!errorOf("amount")}
                  />
                </Field>
                <Field label="Payment type" required error={errorOf("paymentType")}>
                  <SelectInput
                    value={paymentType}
                    onChange={(value) => setPaymentType(value as PaymentType)}
                    options={(Object.keys(PAYMENT_TYPE_LABELS) as PaymentType[]).map((type) => ({
                      value: type,
                      label: PAYMENT_TYPE_LABELS[type],
                    }))}
                  />
                </Field>
                <Field label="Date" required error={errorOf("date")}>
                  <DateInput value={date} onChange={setDate} hasError={!!errorOf("date")} />
                </Field>
                <Field label="Notes" error={errorOf("notes")}>
                  <input
                    value={notes}
                    maxLength={500}
                    placeholder="Enter Notes"
                    aria-label="Notes"
                    onChange={(event) => setNotes(event.target.value)}
                    onFocus={notesFocus.on}
                    onBlur={notesFocus.off}
                    style={{
                      width: "100%",
                      height: 40,
                      border: `1px solid ${notesFocus.value ? COLORS.teal : COLORS.borderStrong}`,
                      borderRadius: 8,
                      padding: "0 12px",
                      fontSize: 14,
                      outline: "none",
                      boxShadow: notesFocus.value ? `0 0 0 3px ${COLORS.focusRing}` : "none",
                    }}
                  />
                </Field>
              </div>
            )}
          </div>
        </>
      )}
    </MasterDataModal>
  );
}
