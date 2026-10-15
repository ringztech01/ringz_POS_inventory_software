"use client";

import { useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { ArrowLeft, Minus, PackageSearch, Pencil, Plus, Trash2 } from "lucide-react";
import type { PurchaseStatus } from "@prisma/client";
import { useToggleState } from "@/components/layout/hooks";
import { COLORS, FONTS } from "@/components/layout/theme";
import GhostButton from "@/components/ui/GhostButton";
import PrimaryButton from "@/components/ui/PrimaryButton";
import ProductSearchField from "@/components/ui/ProductSearchField";
import { computeLine, computeOrder, sumSubtotals } from "@/lib/pricing";
import { formatNaira } from "@/lib/format";
import {
  createPurchase,
  getPurchaseStockForProducts,
  searchProductsForPurchase,
  updatePurchase,
} from "@/app/(dashboard)/purchases/actions";
import type {
  FormOption,
  PurchaseFieldName,
  PurchaseFormInitial,
  PurchaseLine,
  PurchaseProductSearchResult,
  PurchaseSubmitPayload,
} from "@/app/(dashboard)/purchases/types";
import { DateInput, DecimalInput, Field, SelectInput } from "./form-fields";
import PurchaseLineModal, { type PurchaseLineEdit } from "./PurchaseLineModal";
import { PURCHASE_STATUS_LABELS } from "./purchase-display";

export type { PurchaseLine };

const ITEMS_GRID = "minmax(200px,1.3fr) 140px 110px 180px 120px 120px 140px 70px";
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
const STATUS_OPTIONS = (["RECEIVED", "PENDING", "ORDERED"] as const).map((value) => ({
  value,
  label: PURCHASE_STATUS_LABELS[value],
}));

const MAX_QTY = 1_000_000;

// Local calendar date as YYYY-MM-DD. toISOString() would give the UTC date,
// which is "yesterday" just after midnight in Lagos (UTC+1).
function todayInputValue(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function lineFromProduct(product: PurchaseProductSearchResult): PurchaseLine {
  return {
    productId: product.id,
    name: product.name,
    code: product.code,
    unitName: product.unitName,
    stock: product.stock,
    unitCost: product.cost,
    quantity: 1,
    discountType: "FIXED",
    discount: "0",
    // Line tax defaults to the product's own tax settings.
    taxType: product.taxType,
    taxRate: product.orderTax,
    purchaseUnit: "Pic",
  };
}

function SmallIconButton({
  title,
  onClick,
  tone,
  size,
  radius,
  children,
}: {
  title: string;
  onClick: () => void;
  tone: "teal" | "danger" | "neutral";
  size: number;
  radius: number | string;
  children: ReactNode;
}) {
  const hover = useToggleState();
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
      onMouseEnter={hover.on}
      onMouseLeave={hover.off}
      style={{
        width: size,
        height: size,
        flex: "0 0 auto",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: hover.value ? hoverStyles.background : "#fff",
        border: `1px solid ${hover.value ? hoverStyles.borderColor : COLORS.borderStrong}`,
        borderRadius: radius,
        cursor: "pointer",
        color: hover.value ? hoverStyles.color : COLORS.slate,
        transition: "background .12s",
      }}
    >
      {children}
    </button>
  );
}

function QtyStepper({ line, onChange }: { line: PurchaseLine; onChange: (quantity: number) => void }) {
  return (
    <span style={{ display: "flex", alignItems: "center", justifySelf: "start" }}>
      <SmallIconButton
        title={`Decrease quantity for ${line.name}`}
        onClick={() => onChange(line.quantity - 1)}
        tone="neutral"
        size={32}
        radius="6px 0 0 6px"
      >
        <Minus size={13} strokeWidth={2} />
      </SmallIconButton>
      <input
        value={line.quantity}
        readOnly
        aria-label={`Quantity for ${line.name}`}
        style={{
          width: 48,
          height: 32,
          border: `1px solid ${COLORS.borderStrong}`,
          borderLeft: "none",
          borderRight: "none",
          textAlign: "center",
          fontFamily: FONTS.mono,
          fontSize: 13,
          outline: "none",
          background: "#fff",
        }}
      />
      <SmallIconButton
        title={`Increase quantity for ${line.name}`}
        onClick={() => onChange(line.quantity + 1)}
        tone="neutral"
        size={32}
        radius="0 6px 6px 0"
      >
        <Plus size={13} strokeWidth={2} />
      </SmallIconButton>
    </span>
  );
}

function ItemRow({
  line,
  onQuantityChange,
  onEdit,
  onRemove,
}: {
  line: PurchaseLine;
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
        gridTemplateColumns: ITEMS_GRID,
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
      <QtyStepper line={line} onChange={onQuantityChange} />
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

// Create and edit share this form. In edit mode it starts from the saved
// purchase (`initial`) and saves through updatePurchase, which reconciles
// stock by difference instead of re-running create's stock logic.
export default function PurchaseForm({
  warehouses,
  suppliers,
  mode = "create",
  purchaseId,
  initial,
}: {
  warehouses: FormOption[];
  suppliers: FormOption[];
  mode?: "create" | "edit";
  purchaseId?: string;
  initial?: PurchaseFormInitial;
}) {
  const isEdit = mode === "edit" && !!purchaseId;
  const [date, setDate] = useState(initial?.date ?? todayInputValue());
  const [warehouseId, setWarehouseId] = useState(initial?.warehouseId ?? "");
  const [supplierId, setSupplierId] = useState(initial?.supplierId ?? "");
  const [lines, setLines] = useState<PurchaseLine[]>(initial?.lines ?? []);
  const [orderTax, setOrderTax] = useState(initial?.orderTax ?? "");
  const [discount, setDiscount] = useState(initial?.discount ?? "");
  const [shipping, setShipping] = useState(initial?.shipping ?? "");
  const [status, setStatus] = useState<PurchaseStatus>(initial?.status ?? "RECEIVED");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
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

  const editingLine = lines.find((line) => line.productId === editingProductId) ?? null;

  // Purchase lines aren't tied to a warehouse, so switching warehouse keeps
  // the items and just refreshes their reference stock for the new one.
  async function handleWarehouseChange(nextWarehouseId: string) {
    setWarehouseId(nextWarehouseId);
    const id = ++stockRequest.current;
    const productIds = lines.map((line) => line.productId);
    if (!nextWarehouseId || productIds.length === 0) return;

    const stock = await getPurchaseStockForProducts(nextWarehouseId, productIds);
    if (id !== stockRequest.current) return;
    setLines((current) => current.map((line) => ({ ...line, stock: stock[line.productId] ?? line.stock })));
  }

  function addProduct(product: PurchaseProductSearchResult) {
    if (lines.some((line) => line.productId === product.id)) {
      toast.error(`${product.name} is already in the order.`);
      return;
    }
    setLines((current) => [...current, lineFromProduct(product)]);
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
    if (isPending) return;
    setFieldErrors({});

    // Only ids and the user's inputs go to the server — it re-reads the
    // products and recomputes every total itself.
    const payload: PurchaseSubmitPayload = {
      date,
      warehouseId,
      supplierId,
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
      })),
    };

    startTransition(async () => {
      const result =
        isEdit && purchaseId ? await updatePurchase(purchaseId, payload) : await createPurchase(payload);

      if (result.ok) {
        const verb = isEdit ? "updated" : "saved";
        toast.success(result.reference ? `Purchase ${result.reference} ${verb}.` : `Purchase ${verb}.`);
        router.push("/purchases");
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
            {isEdit ? "Edit Purchase" : "Create Purchase"}
          </h1>
          <p style={{ margin: 0, fontSize: 13.5, color: COLORS.slateMid }}>
            Fields marked <span style={{ color: COLORS.danger }}>*</span> are required.
          </p>
        </div>
        <GhostButton href="/purchases" paddingX={18}>
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
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: "20px 32px" }}>
          <Field label="Date" required error={errorOf("date")}>
            <DateInput value={date} onChange={setDate} hasError={!!errorOf("date")} />
          </Field>
          <Field label="Warehouse" required error={errorOf("warehouseId")}>
            <SelectInput
              value={warehouseId}
              onChange={handleWarehouseChange}
              options={warehouses.map((w) => ({ value: w.id, label: w.name }))}
              placeholder="Choose Warehouse"
              hasError={!!errorOf("warehouseId")}
            />
          </Field>
          <Field label="Supplier" required error={errorOf("supplierId")}>
            <SelectInput
              value={supplierId}
              onChange={setSupplierId}
              options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
              placeholder="Choose Supplier"
              hasError={!!errorOf("supplierId")}
            />
          </Field>
        </div>

        <Field label="Product">
          <ProductSearchField
            search={(query) => searchProductsForPurchase(warehouseId, query)}
            searchKey={warehouseId}
            onSelect={addProduct}
            disabled={!warehouseId}
            disabledHint="Choose a warehouse first — its current stock is shown for reference."
            renderMeta={(product) => (
              <span style={{ fontFamily: FONTS.mono, fontSize: 12, fontWeight: 600, color: COLORS.slate }}>
                {product.stock} in stock
              </span>
            )}
          />
        </Field>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: COLORS.text }}>
            Order items <span style={{ color: COLORS.danger }}>*</span>
          </label>
          <div style={{ border: `1px solid ${COLORS.border}`, borderRadius: 12, overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <div style={{ minWidth: 1040 }}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: ITEMS_GRID,
                    columnGap: 16,
                    alignItems: "center",
                    padding: "0 20px",
                    height: 44,
                    background: COLORS.bgInput,
                    borderBottom: `1px solid ${COLORS.border}`,
                    whiteSpace: "nowrap",
                  }}
                >
                  {ITEM_HEADERS.map(({ label, right }) => (
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
                    line={line}
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

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: "20px 32px" }}>
          <Field label="Status" required error={errorOf("status")}>
            <SelectInput
              value={status}
              onChange={(value) => setStatus(value as PurchaseStatus)}
              options={STATUS_OPTIONS}
            />
          </Field>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: COLORS.text }}>Notes</label>
          <textarea
            placeholder="Enter Notes"
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
          <GhostButton href="/purchases" paddingX={20}>
            Cancel
          </GhostButton>
          <PrimaryButton type="submit" disabled={isPending} paddingX={24} fontSize={14}>
            {isPending ? "Saving…" : "Save purchase"}
          </PrimaryButton>
        </div>
      </form>

      {/* Outside the <form>: the modal has its own form, and forms can't nest. */}
      {editingLine && (
        <PurchaseLineModal line={editingLine} onClose={() => setEditingProductId(null)} onSave={saveLineEdit} />
      )}
    </div>
  );
}
