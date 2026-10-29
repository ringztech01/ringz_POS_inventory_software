"use client";

import { useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { ArrowLeft, Minus, PackageSearch, Pencil, Plus, Trash2 } from "lucide-react";
import type { PaymentType } from "@prisma/client";
import { useToggleState } from "@/components/layout/hooks";
import { COLORS, FONTS } from "@/components/layout/theme";
import GhostButton from "@/components/ui/GhostButton";
import PrimaryButton from "@/components/ui/PrimaryButton";
import ProductSearchField from "@/components/ui/ProductSearchField";
import QtyInput from "@/components/ui/QtyInput";
import { computeLine, computeOrder, sumSubtotals, toDecimal } from "@/lib/pricing";
import { computePaymentState } from "@/lib/payments";
import { formatNaira } from "@/lib/format";
import ConfirmDeleteModal from "@/components/ui/ConfirmDeleteModal";
import type {
  FormOption,
  PurchaseActionState,
  PurchaseFieldName,
  PurchaseFormInitial,
  PurchaseLine,
  PurchaseProductSearchResult,
  PurchaseSubmitPayload,
} from "@/app/(dashboard)/purchases/types";
import { DateInput, DecimalInput, Field, SelectInput } from "./form-fields";
import PurchaseLineModal, { type PurchaseLineEdit } from "./PurchaseLineModal";
import { PURCHASE_UNITS } from "@/lib/purchase-units";
import { PAYMENT_TYPE_LABELS, PURCHASE_STATUS_LABELS, PaymentStatusPill, type DocumentStatus } from "./purchase-display";

export type { PurchaseLine };

const ITEMS_GRID = "minmax(200px,1.3fr) 140px 110px 180px 120px 120px 140px 70px";
// RingzPOS Transfers design: a wider Stock column.
const TRANSFER_ITEMS_GRID = "minmax(200px,1.3fr) 140px 140px 180px 120px 120px 140px 70px";
const ITEM_HEADERS: { label: string; right?: boolean }[] = [
  { label: "Product" },
  { label: "Net unit cost", right: true },
  { label: "Stock" },
  { label: "Qty" },
  { label: "Discount", right: true },
  { label: "Tax", right: true },
  { label: "Subtotal", right: true },
  { label: "Action", right: true },
];

// Design order for the Status select.
const STATUS_OPTIONS: { value: DocumentStatus; label: string }[] = (["RECEIVED", "PENDING", "ORDERED"] as const).map((value) => ({
  value,
  label: PURCHASE_STATUS_LABELS[value],
}));

export const MAX_QTY = 1_000_000;

// Local calendar date as YYYY-MM-DD. toISOString() would give the UTC date,
// which is "yesterday" just after midnight in Lagos (UTC+1).
function todayInputValue(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// `unitCost` holds the line's unit price either way: the product's cost on
// purchase documents, its selling price on sales (priceField). Also builds
// POS cart lines, so a POS line starts exactly like a Sales line.
export function lineFromProduct(product: PurchaseProductSearchResult, priceField: "cost" | "price", unit: string): PurchaseLine {
  return {
    productId: product.id,
    name: product.name,
    code: product.code,
    unitName: product.unitName,
    stock: product.stock,
    unitCost: product[priceField],
    quantity: 1,
    discountType: "FIXED",
    discount: "0",
    // Line tax defaults to the product's own tax settings.
    taxType: product.taxType,
    taxRate: product.orderTax,
    purchaseUnit: unit,
  };
}

function SmallIconButton({
  title,
  onClick,
  tone,
  size,
  radius,
  disabled,
  children,
}: {
  title: string;
  onClick: () => void;
  tone: "teal" | "danger" | "neutral";
  size: number;
  radius: number | string;
  disabled?: boolean;
  children: ReactNode;
}) {
  const hover = useToggleState();
  const hovered = hover.value && !disabled;
  const hoverStyles = {
    teal: { background: COLORS.tealTint, color: COLORS.teal, borderColor: COLORS.tealBorder },
    danger: { background: COLORS.dangerBg, color: COLORS.danger, borderColor: COLORS.dangerBorder },
    neutral: { background: COLORS.bgApp, color: COLORS.slate, borderColor: COLORS.borderStrong },
  }[tone];

  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={hover.on}
      onMouseLeave={hover.off}
      style={{
        width: size,
        height: size,
        flex: "0 0 auto",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: hovered ? hoverStyles.background : "#fff",
        border: `1px solid ${hovered ? hoverStyles.borderColor : COLORS.borderStrong}`,
        borderRadius: radius,
        cursor: disabled ? "not-allowed" : "pointer",
        color: disabled ? COLORS.slateLight : hovered ? hoverStyles.color : COLORS.slate,
        transition: "background .12s",
      }}
    >
      {children}
    </button>
  );
}

// `max` (returns only): the stock available to return — current stock, plus
// what this return already took out when editing a Received one. "+" stops
// there, and a
// warning shows if the quantity is above it (e.g. stock changed meanwhile);
// the server re-checks on save either way.
function QtyStepper({
  line,
  max,
  capLabel = "stock",
  onChange,
}: {
  line: PurchaseLine;
  max?: number;
  // What the cap is, for the warning: "stock" or "returnable".
  capLabel?: string;
  onChange: (quantity: number) => void;
}) {
  const exceeds = max !== undefined && line.quantity > max;

  return (
    <span style={{ display: "flex", flexDirection: "column", gap: 4, justifySelf: "start" }}>
      <span style={{ display: "flex", alignItems: "center" }}>
      <SmallIconButton
        title={`Decrease quantity for ${line.name}`}
        onClick={() => onChange(line.quantity - 1)}
        tone="neutral"
        size={32}
        radius="6px 0 0 6px"
      >
        <Minus size={13} strokeWidth={2} />
      </SmallIconButton>
      <QtyInput
        value={line.quantity}
        onChange={onChange}
        ariaLabel={`Quantity for ${line.name}`}
        hasError={exceeds}
      />
      <SmallIconButton
        title={`Increase quantity for ${line.name}`}
        onClick={() => onChange(line.quantity + 1)}
        tone="neutral"
        size={32}
        radius="0 6px 6px 0"
        disabled={max !== undefined && line.quantity >= max}
      >
        <Plus size={13} strokeWidth={2} />
      </SmallIconButton>
      </span>
      {exceeds && <span style={{ fontSize: 11, color: COLORS.danger }}>Exceeds {capLabel} ({max})</span>}
    </span>
  );
}

function ItemRow({
  grid,
  line,
  maxQuantity,
  capLabel,
  onQuantityChange,
  onEdit,
  onRemove,
}: {
  grid: string;
  line: PurchaseLine;
  maxQuantity?: number;
  capLabel?: string;
  onQuantityChange: (quantity: number) => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const hover = useToggleState();
  const priced = computeLine(line);
  const money = { fontFamily: FONTS.mono, fontSize: 13, textAlign: "right" as const };

  return (
    <div
      onMouseEnter={hover.on}
      onMouseLeave={hover.off}
      style={{
        display: "grid",
        gridTemplateColumns: grid,
        columnGap: 16,
        alignItems: "center",
        padding: "0 20px",
        height: 76,
        borderBottom: `1px solid ${COLORS.bgApp}`,
        whiteSpace: "nowrap",
        background: hover.value ? COLORS.bgApp : "transparent",
        transition: "background .12s",
      }}
    >
      <span style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
        <span style={{ fontFamily: FONTS.mono, fontSize: 13, fontWeight: 600, color: COLORS.ink }}>{line.code}</span>
        <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              background: "#e2f4ec",
              color: "#0b6146",
              padding: "4px 9px",
              borderRadius: 6,
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {line.name}
          </span>
          <SmallIconButton title="Edit item" onClick={onEdit} tone="teal" size={26} radius={6}>
            <Pencil size={13} strokeWidth={1.8} />
          </SmallIconButton>
        </span>
      </span>
      <span style={{ ...money, fontWeight: 600 }}>{formatNaira(priced.netUnitCost.toFixed(2))}</span>
      <span
        style={{
          fontFamily: FONTS.mono,
          fontSize: 12,
          fontWeight: 600,
          background: "#fdf1d8",
          color: "#7d5106",
          padding: "4px 9px",
          borderRadius: 6,
          justifySelf: "start",
        }}
      >
        {line.stock} {line.unitName.toLowerCase()}
      </span>
      <QtyStepper line={line} max={maxQuantity} capLabel={capLabel} onChange={onQuantityChange} />
      <span style={{ ...money, color: COLORS.slate }}>{formatNaira(priced.discountAmount.toFixed(2))}</span>
      <span style={{ ...money, color: COLORS.slate }}>{formatNaira(priced.taxAmount.toFixed(2))}</span>
      <span style={{ ...money, fontWeight: 600 }}>{formatNaira(priced.subtotal.toFixed(2))}</span>
      <span style={{ justifySelf: "end" }}>
        <SmallIconButton title="Remove item" onClick={onRemove} tone="danger" size={34} radius={8}>
          <Trash2 size={15} strokeWidth={1.8} />
        </SmallIconButton>
      </span>
    </div>
  );
}

// The design's disabled "Sale reference" input.
function ReadOnlyInput({ value, mono, ariaLabel }: { value: string; mono?: boolean; ariaLabel: string }) {
  return (
    <input
      value={value}
      disabled
      aria-label={ariaLabel}
      style={{
        height: 40,
        border: `1px solid ${COLORS.border}`,
        borderRadius: 8,
        padding: "0 12px",
        fontSize: 14,
        fontFamily: mono ? FONTS.mono : FONTS.body,
        background: COLORS.bgApp,
        color: COLORS.slateLight,
      }}
    />
  );
}

function TotalsRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: last ? "16px 18px" : "14px 18px",
        borderBottom: last ? "none" : `1px solid ${COLORS.border}`,
        background: last ? COLORS.tealTint : "transparent",
      }}
    >
      <span style={{ fontSize: last ? 14 : 13.5, fontWeight: last ? 600 : 400, color: last ? COLORS.tealDark : COLORS.slate }}>
        {label}
      </span>
      <span
        style={{
          fontFamily: FONTS.mono,
          fontSize: last ? 15 : 13,
          fontWeight: last ? 600 : 400,
          color: last ? COLORS.tealDark : COLORS.text,
        }}
      >
        {value}
      </span>
    </div>
  );
}

// The create/edit form for purchase documents — Purchases and Purchase
// Returns differ only in the props below. Edit mode starts from the saved
// document (`initial`) and its saveAction reconciles stock by difference
// instead of re-running create's stock logic.
//
// stockDirection:
//   "in"  (Purchase): any active product can be added; switching warehouse
//         keeps the lines and refreshes their reference stock (stockAction).
//   "out" (Return, Sale): searchAction only offers products held in the
//         selected warehouse, quantities are capped at that stock, and
//         switching warehouse (after confirming) clears the lines.
//
// Sales also set priceField "price" (lines default to the selling price),
// unitLabel "Sale unit", the Customer party, and takePayment (Paid amount +
// Payment type + live payment status, create only).
//
// Transfers set `transfer`: From Warehouse + To Warehouse replace Warehouse +
// party. From behaves like an outbound document's warehouse (search scoped to
// it, quantities capped at its stock, confirm-and-clear on change); To can
// never be From — From is left out of its options, and an inline error shows
// if they ever match.
export default function PurchaseForm({
  warehouses,
  parties,
  partyLabel = "Supplier",
  partyField = "supplierId",
  defaultPartyId = "",
  priceField = "cost",
  unitLabel = "Purchase unit",
  takePayment = false,
  fromDocument,
  statusOptions = STATUS_OPTIONS,
  transfer = false,
  units = PURCHASE_UNITS,
  defaultUnit = "Pic",
  mode = "create",
  initial,
  noun,
  listHref,
  stockDirection,
  searchAction,
  stockAction,
  saveAction,
}: {
  warehouses: FormOption[];
  // Supplier or customer options.
  parties: FormOption[];
  partyLabel?: string;
  partyField?: "supplierId" | "customerId";
  defaultPartyId?: string;
  priceField?: "cost" | "price";
  unitLabel?: string;
  takePayment?: boolean;
  // Sale Returns: the document this one is created from. Its reference,
  // party and warehouse are shown read-only (never chosen), there's no
  // product search — lines come pre-filled from it, each capped at its
  // line.maxQuantity ("returnable") — and the payload carries its id.
  fromDocument?: {
    id: string;
    referenceLabel: string;
    reference: string;
    partyName: string;
    warehouseName: string;
  };
  // The first option is the create default.
  statusOptions?: { value: DocumentStatus; label: string }[];
  transfer?: boolean;
  // Line-modal unit choices and the unit new lines start with.
  units?: readonly string[];
  defaultUnit?: string;
  mode?: "create" | "edit";
  initial?: PurchaseFormInitial;
  // "Purchase" | "Purchase Return" — title, button and toast text.
  noun: string;
  // Back/Cancel target and where to go after saving.
  listHref: string;
  stockDirection: "in" | "out";
  // Not needed with fromDocument (no product search there).
  searchAction?: (warehouseId: string, query: string) => Promise<PurchaseProductSearchResult[]>;
  stockAction?: (warehouseId: string, productIds: string[]) => Promise<Record<string, number>>;
  // Server action; on edit the page binds it to the document id. Save is
  // disabled while a module doesn't provide one yet.
  saveAction?: (payload: PurchaseSubmitPayload) => Promise<PurchaseActionState>;
}) {
  const isEdit = mode === "edit";
  const isOutbound = stockDirection === "out";
  const [date, setDate] = useState(initial?.date || todayInputValue());
  const [warehouseId, setWarehouseId] = useState(initial?.warehouseId ?? "");
  const [toWarehouseId, setToWarehouseId] = useState(initial?.toWarehouseId ?? "");
  const [partyId, setPartyId] = useState(initial?.partyId ?? defaultPartyId);
  const [paidAmount, setPaidAmount] = useState("");
  const [paymentType, setPaymentType] = useState<PaymentType>("CASH");
  const [lines, setLines] = useState<PurchaseLine[]>(initial?.lines ?? []);
  const [orderTax, setOrderTax] = useState(initial?.orderTax ?? "");
  const [discount, setDiscount] = useState(initial?.discount ?? "");
  const [shipping, setShipping] = useState(initial?.shipping ?? "");
  const [status, setStatus] = useState<DocumentStatus>(initial?.status ?? statusOptions[0]?.value ?? "RECEIVED");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [pendingWarehouseId, setPendingWarehouseId] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<PurchaseFieldName, string[]>>>({});
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const stockRequest = useRef(0);
  const notesFocus = useToggleState();

  // Live totals — the same lib/pricing.ts the server re-runs on save.
  const order = computeOrder({
    itemsTotal: sumSubtotals(lines.map((line) => computeLine(line).subtotal)),
    taxRate: orderTax,
    discount,
    shipping,
  });

  // Sales: the payment taken with the sale, through the same helper the
  // server uses — so the pill shows exactly what will be saved.
  const paidExceedsTotal = takePayment && toDecimal(paidAmount).greaterThan(order.grandTotal);
  const paymentState = computePaymentState(
    order.grandTotal,
    takePayment && !toDecimal(paidAmount).isZero() ? [{ amount: paidAmount, paymentType, date: new Date() }] : [],
  );

  const editingLine = lines.find((line) => line.productId === editingProductId) ?? null;
  const itemsGrid = transfer ? TRANSFER_ITEMS_GRID : ITEMS_GRID;
  // Transfers: From ≠ To (the server re-checks).
  const sameWarehouse = transfer && !!warehouseId && warehouseId === toWarehouseId;

  async function handleWarehouseChange(nextWarehouseId: string) {
    // Return lines belong to the warehouse they're taken out of — confirm,
    // then clear them (see confirmWarehouseChange).
    if (isOutbound) {
      if (lines.length > 0 && nextWarehouseId !== warehouseId) setPendingWarehouseId(nextWarehouseId);
      else setWarehouseId(nextWarehouseId);
      return;
    }

    // Purchase lines aren't tied to a warehouse, so switching warehouse keeps
    // the items and just refreshes their reference stock for the new one.
    setWarehouseId(nextWarehouseId);
    const id = ++stockRequest.current;
    const productIds = lines.map((line) => line.productId);
    if (!nextWarehouseId || productIds.length === 0 || !stockAction) return;

    const stock = await stockAction(nextWarehouseId, productIds);
    if (id !== stockRequest.current) return;
    setLines((current) => current.map((line) => ({ ...line, stock: stock[line.productId] ?? line.stock })));
  }

  function confirmWarehouseChange() {
    if (pendingWarehouseId !== null) {
      setWarehouseId(pendingWarehouseId);
      setLines([]);
    }
    setPendingWarehouseId(null);
  }

  function addProduct(product: PurchaseProductSearchResult) {
    if (lines.some((line) => line.productId === product.id)) {
      toast.error(`${product.name} is already in the order.`);
      return;
    }
    setLines((current) => [...current, lineFromProduct(product, priceField, defaultUnit)]);
  }

  function updateLine(productId: string, patch: Partial<PurchaseLine>) {
    setLines((current) => current.map((line) => (line.productId === productId ? { ...line, ...patch } : line)));
  }

  function setQuantity(productId: string, quantity: number) {
    updateLine(productId, { quantity: Math.min(MAX_QTY, Math.max(1, quantity)) });
  }

  function saveLineEdit(edit: PurchaseLineEdit) {
    if (editingProductId) updateLine(editingProductId, edit);
    setEditingProductId(null);
  }

  function removeLine(productId: string) {
    setLines((current) => current.filter((line) => line.productId !== productId));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending || !saveAction) return;
    setFieldErrors({});

    // Only ids and the user's inputs go to the server — it re-reads the
    // products and recomputes every total itself.
    const payload: PurchaseSubmitPayload = {
      date,
      // From-document returns send only the source id; the server takes the
      // party and warehouse from that document.
      ...(fromDocument
        ? { saleId: fromDocument.id }
        : transfer
          ? { fromWarehouseId: warehouseId, toWarehouseId }
          : { warehouseId, [partyField]: partyId }),
      ...(takePayment ? { paidAmount, paymentType } : {}),
      status,
      orderTax,
      discount,
      shipping,
      notes,
      items: lines.map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
        unitCost: line.unitCost,
        discountType: line.discountType,
        discount: line.discount,
        taxType: line.taxType,
        taxRate: line.taxRate,
        purchaseUnit: line.purchaseUnit,
        ...(line.saleItemId ? { saleItemId: line.saleItemId } : {}),
      })),
    };

    startTransition(async () => {
      const result = await saveAction(payload);

      if (result.ok) {
        const verb = isEdit ? "updated" : "saved";
        toast.success(result.reference ? `${noun} ${result.reference} ${verb}.` : `${noun} ${verb}.`);
        router.push(listHref);
        router.refresh();
      } else {
        setFieldErrors(result.fieldErrors ?? {});
        toast.error(result.error ?? "Something went wrong.");
      }
    });
  }

  const errorOf = (field: PurchaseFieldName) => fieldErrors[field]?.[0];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <h1
            style={{
              margin: 0,
              fontFamily: FONTS.display,
              fontSize: 26,
              fontWeight: 700,
              letterSpacing: "-.015em",
            }}
          >
            {isEdit ? `Edit ${noun}` : `Create ${noun}`}
          </h1>
          <p style={{ margin: 0, fontSize: 13.5, color: COLORS.slateMid }}>
            Fields marked <span style={{ color: COLORS.danger }}>*</span> are required.
          </p>
        </div>
        <GhostButton href={listHref} paddingX={18}>
          <ArrowLeft size={14} strokeWidth={1.7} />
          Back
        </GhostButton>
      </div>

      <form
        onSubmit={handleSubmit}
        noValidate
        style={{
          background: "#fff",
          border: `1px solid ${COLORS.border}`,
          borderRadius: 12,
          boxShadow: "0 1px 2px rgba(23,27,28,.06)",
          padding: 32,
          display: "flex",
          flexDirection: "column",
          gap: 24,
        }}
      >
        {fromDocument ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: "20px 32px" }}>
            <Field label="Date" required error={errorOf("date")}>
              <DateInput value={date} onChange={setDate} hasError={!!errorOf("date")} />
            </Field>
            <Field label={fromDocument.referenceLabel} required>
              <ReadOnlyInput value={fromDocument.reference} mono ariaLabel={fromDocument.referenceLabel} />
            </Field>
            <Field label="Status" required error={errorOf("status")}>
              <SelectInput
                value={status}
                onChange={(value) => setStatus(value as DocumentStatus)}
                options={statusOptions}
              />
            </Field>
            {/* Not in the design: the source document's party and warehouse,
                read-only, styled like the Sale reference field. */}
            <Field label={partyLabel}>
              <ReadOnlyInput value={fromDocument.partyName} ariaLabel={partyLabel} />
            </Field>
            <Field label="Warehouse">
              <ReadOnlyInput value={fromDocument.warehouseName} ariaLabel="Warehouse" />
            </Field>
          </div>
        ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: "20px 32px" }}>
          <Field label="Date" required error={errorOf("date")}>
            <DateInput value={date} onChange={setDate} hasError={!!errorOf("date")} />
          </Field>
          <Field
            label={transfer ? "From Warehouse" : "Warehouse"}
            required
            error={errorOf(transfer ? "fromWarehouseId" : "warehouseId")}
          >
            <SelectInput
              value={warehouseId}
              onChange={handleWarehouseChange}
              options={warehouses.map((w) => ({ value: w.id, label: w.name }))}
              placeholder="Choose Warehouse"
              hasError={!!errorOf(transfer ? "fromWarehouseId" : "warehouseId")}
            />
          </Field>
          {transfer ? (
            <Field
              label="To Warehouse"
              required
              error={sameWarehouse ? "To must be a different warehouse from From." : errorOf("toWarehouseId")}
            >
              <SelectInput
                value={toWarehouseId}
                onChange={setToWarehouseId}
                // From is left out — unless it's already the chosen To, so the
                // clash stays visible next to its error.
                options={warehouses
                  .filter((w) => w.id !== warehouseId || w.id === toWarehouseId)
                  .map((w) => ({ value: w.id, label: w.name }))}
                placeholder="Choose Warehouse"
                hasError={sameWarehouse || !!errorOf("toWarehouseId")}
              />
            </Field>
          ) : (
          <Field label={partyLabel} required error={errorOf(partyField)}>
            <SelectInput
              value={partyId}
              onChange={setPartyId}
              options={parties.map((party) => ({ value: party.id, label: party.name }))}
              placeholder={`Choose ${partyLabel}`}
              hasError={!!errorOf(partyField)}
            />
          </Field>
          )}
        </div>
        )}

        {!fromDocument && (
        <Field label="Product">
          <ProductSearchField
            search={(query) => (searchAction ? searchAction(warehouseId, query) : Promise.resolve([]))}
            searchKey={warehouseId}
            onSelect={addProduct}
            disabled={!warehouseId}
            disabledHint={
              transfer
                ? "Choose the From warehouse first — only products in stock there can be transferred."
                : "Choose a warehouse first — its current stock is shown for reference."
            }
            renderMeta={(product) => (
              <span style={{ fontFamily: FONTS.mono, fontSize: 12, fontWeight: 600, color: COLORS.slate }}>
                {product.stock} in stock
              </span>
            )}
          />
        </Field>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {fromDocument && <span style={{ fontSize: 13, fontWeight: 600, color: COLORS.text }}>Product list</span>}
          <label style={{ fontSize: 13, fontWeight: 600, color: COLORS.text }}>
            Order items <span style={{ color: COLORS.danger }}>*</span>
          </label>
          <div style={{ border: `1px solid ${COLORS.border}`, borderRadius: 12, overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <div style={{ minWidth: 1040 }}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: itemsGrid,
                    columnGap: 16,
                    alignItems: "center",
                    padding: "0 20px",
                    height: 44,
                    background: COLORS.bgInput,
                    borderBottom: `1px solid ${COLORS.border}`,
                    whiteSpace: "nowrap",
                  }}
                >
                  {ITEM_HEADERS.map(({ label: header, right }) => ({
                    label: header === "Net unit cost" ? `Net unit ${priceField}` : header,
                    right,
                  })).map(({ label, right }) => (
                    <span
                      key={label}
                      style={{
                        fontSize: 11.5,
                        fontWeight: 600,
                        letterSpacing: ".08em",
                        textTransform: "uppercase",
                        color: COLORS.slateMid,
                        textAlign: right ? "right" : "left",
                      }}
                    >
                      {label}
                    </span>
                  ))}
                </div>

                {lines.map((line) => (
                  <ItemRow
                    key={line.productId}
                    grid={itemsGrid}
                    line={line}
                    maxQuantity={
                      line.maxQuantity ?? (isOutbound ? line.stock + (line.reserved ?? 0) : undefined)
                    }
                    capLabel={line.maxQuantity !== undefined ? "returnable" : "stock"}
                    onQuantityChange={(quantity) => setQuantity(line.productId, quantity)}
                    onEdit={() => setEditingProductId(line.productId)}
                    onRemove={() => removeLine(line.productId)}
                  />
                ))}

                {lines.length === 0 && (
                  <div
                    style={{
                      padding: "40px 20px",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 10,
                    }}
                  >
                    <span
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 11,
                        background: COLORS.bgApp,
                        color: COLORS.slateLight,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <PackageSearch size={19} strokeWidth={1.6} />
                    </span>
                    <span style={{ fontSize: 13.5, color: COLORS.slateMid }}>
                      No items yet — search a product above to add one.
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
          {fieldErrors.items?.map((message) => (
            <span key={message} style={{ fontSize: 12, color: COLORS.danger }}>
              {message}
            </span>
          ))}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <div style={{ width: 420, border: `1px solid ${COLORS.border}`, borderRadius: 12, overflow: "hidden" }}>
            <TotalsRow
              label="Order Tax"
              value={`${formatNaira(order.orderTaxAmount.toFixed(2))} (${order.taxRate.toFixed(2)}%)`}
            />
            <TotalsRow label="Discount" value={formatNaira(order.discount.toFixed(2))} />
            <TotalsRow label="Shipping" value={formatNaira(order.shipping.toFixed(2))} />
            <TotalsRow label="Grand Total" value={formatNaira(order.grandTotal.toFixed(2))} last />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: "20px 32px" }}>
          <Field label="Order Tax" error={errorOf("orderTax")}>
            <DecimalInput
              value={orderTax}
              onChange={setOrderTax}
              suffix="%"
              ariaLabel="Order Tax"
              hasError={!!errorOf("orderTax")}
            />
          </Field>
          <Field label="Discount" error={errorOf("discount")}>
            <DecimalInput
              value={discount}
              onChange={setDiscount}
              suffix="₦"
              ariaLabel="Discount"
              hasError={!!errorOf("discount")}
            />
          </Field>
          <Field label="Shipping" error={errorOf("shipping")}>
            <DecimalInput
              value={shipping}
              onChange={setShipping}
              suffix="₦"
              ariaLabel="Shipping"
              hasError={!!errorOf("shipping")}
            />
          </Field>
        </div>

        {!fromDocument && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: "20px 32px" }}>
            <Field label="Status" required error={errorOf("status")}>
              <SelectInput
                value={status}
                onChange={(value) => setStatus(value as DocumentStatus)}
                options={statusOptions}
              />
            </Field>
          </div>
        )}

        {takePayment && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: "20px 32px" }}>
            <Field
              label="Paid amount"
              error={paidExceedsTotal ? "Paid can't be more than the grand total." : errorOf("paidAmount")}
            >
              <DecimalInput
                value={paidAmount}
                onChange={setPaidAmount}
                suffix="₦"
                ariaLabel="Paid amount"
                hasError={paidExceedsTotal || !!errorOf("paidAmount")}
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
            {/* Read-only: computed from the paid amount vs the grand total. */}
            <Field label="Payment status">
              <div style={{ height: 40, display: "flex", alignItems: "center" }} aria-label="Payment status">
                {/* With no items yet the total is ₦0, which computePaymentState
                    rightly calls Paid for a real ₦0 sale — but an empty form
                    isn't a sale yet, so show Unpaid until it has lines. */}
                <PaymentStatusPill paymentStatus={lines.length === 0 ? "UNPAID" : paymentState.paymentStatus} />
              </div>
            </Field>
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: COLORS.text }}>{transfer ? "Note" : "Notes"}</label>
          <textarea
            placeholder={transfer ? "Enter Note" : "Enter Notes"}
            value={notes}
            maxLength={2000}
            onChange={(event) => setNotes(event.target.value)}
            onFocus={notesFocus.on}
            onBlur={notesFocus.off}
            style={{
              minHeight: 110,
              border: `1px solid ${notesFocus.value ? COLORS.teal : COLORS.borderStrong}`,
              borderRadius: 8,
              padding: "10px 12px",
              fontSize: 14,
              outline: "none",
              resize: "vertical",
              fontFamily: FONTS.body,
              boxShadow: notesFocus.value ? `0 0 0 3px ${COLORS.focusRing}` : "none",
            }}
          />
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 12,
            paddingTop: 24,
            borderTop: `1px solid ${COLORS.border}`,
          }}
        >
          <GhostButton href={listHref} paddingX={20}>
            Cancel
          </GhostButton>
          <PrimaryButton type="submit" disabled={isPending || !saveAction} paddingX={24} fontSize={14}>
            {isPending ? "Saving…" : `Save ${noun.toLowerCase()}`}
          </PrimaryButton>
        </div>
      </form>

      {/* Outside the <form>: the modal has its own form, and forms can't nest. */}
      {pendingWarehouseId !== null && (
        <ConfirmDeleteModal
          title="Change warehouse?"
          message={`Switching warehouses will clear the ${lines.length} item${lines.length === 1 ? "" : "s"} already added, since the items must be in stock in the selected warehouse.`}
          confirmLabel="Clear items"
          pendingLabel="Clearing…"
          tone="primary"
          onCancel={() => setPendingWarehouseId(null)}
          onConfirm={confirmWarehouseChange}
        />
      )}

      {editingLine && (
        <PurchaseLineModal
          line={editingLine}
          priceField={priceField}
          unitLabel={unitLabel}
          units={units}
          onClose={() => setEditingProductId(null)}
          onSave={saveLineEdit}
        />
      )}
    </div>
  );
}
