"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { ArrowLeft, ChevronDown, Minus, Plus, PackageSearch, Search, Trash2 } from "lucide-react";
import { useToggleState } from "@/components/layout/hooks";
import { COLORS, FONTS } from "@/components/layout/theme";
import PrimaryButton from "@/components/ui/PrimaryButton";
import GhostButton from "@/components/ui/GhostButton";
import ConfirmDeleteModal from "@/components/ui/ConfirmDeleteModal";
import { createAdjustment, searchProductsForAdjustment } from "@/app/(dashboard)/adjustments/actions";
import type { AdjustmentProductSearchResult, AdjustmentFieldName, FormOption } from "@/app/(dashboard)/adjustments/types";

type AdjustmentItemType = "Addition" | "Subtraction";

type AdjustmentItemRow = {
  productId: string;
  name: string;
  code: string;
  stock: number;
  qty: number;
  type: AdjustmentItemType;
};

function todayInputValue(): string {
  return new Date().toISOString().slice(0, 10);
}

function Field({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <label style={{ fontSize: 13, fontWeight: 600, color: COLORS.text }}>
        {label} {required && <span style={{ color: COLORS.danger }}>*</span>}
      </label>
      {children}
      {error && <span style={{ fontSize: 12, color: COLORS.danger }}>{error}</span>}
    </div>
  );
}

function SelectInput({
  value,
  onChange,
  options,
  placeholder,
  hasError,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  placeholder: string;
  hasError?: boolean;
}) {
  const focus = useToggleState();

  return (
    <div style={{ position: "relative" }}>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={focus.on}
        onBlur={focus.off}
        style={{
          appearance: "none",
          width: "100%",
          height: 40,
          border: `1px solid ${hasError ? COLORS.danger : focus.value ? COLORS.teal : COLORS.borderStrong}`,
          borderRadius: 8,
          padding: "0 36px 0 12px",
          fontSize: 14,
          background: "#fff",
          cursor: "pointer",
          outline: "none",
          boxShadow: focus.value ? `0 0 0 3px ${COLORS.focusRing}` : "none",
        }}
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown
        size={14}
        strokeWidth={1.8}
        color={COLORS.slateMid}
        style={{ position: "absolute", right: 12, top: 13, pointerEvents: "none" }}
      />
    </div>
  );
}

export default function AdjustmentForm({ warehouses }: { warehouses: FormOption[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<AdjustmentFieldName, string[]>>>({});

  const [warehouseId, setWarehouseId] = useState("");
  const [date, setDate] = useState(todayInputValue());
  const [items, setItems] = useState<AdjustmentItemRow[]>([]);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<AdjustmentProductSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const searchFocus = useToggleState();

  const [pendingWarehouseId, setPendingWarehouseId] = useState<string | null>(null);

  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    const handle = setTimeout(async () => {
      if (!warehouseId || searchQuery.trim().length === 0) {
        setSearchResults([]);
        setIsSearching(false);
        return;
      }

      setIsSearching(true);
      const results = await searchProductsForAdjustment(warehouseId, searchQuery);
      setSearchResults(results);
      setIsSearching(false);
    }, 300);

    return () => clearTimeout(handle);
  }, [warehouseId, searchQuery]);

  function handleWarehouseChange(nextWarehouseId: string) {
    if (items.length > 0 && nextWarehouseId !== warehouseId) {
      setPendingWarehouseId(nextWarehouseId);
      return;
    }
    setWarehouseId(nextWarehouseId);
  }

  function confirmWarehouseChange() {
    if (pendingWarehouseId !== null) {
      setWarehouseId(pendingWarehouseId);
      setItems([]);
    }
    setPendingWarehouseId(null);
  }

  function addItem(result: AdjustmentProductSearchResult) {
    const existing = items.find((item) => item.productId === result.id);
    if (existing) {
      toast.error(`${result.name} is already in the list.`);
      setSearchQuery("");
      setSearchResults([]);
      rowRefs.current[result.id]?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    setItems((current) => [
      ...current,
      { productId: result.id, name: result.name, code: result.code, stock: result.stock, qty: 1, type: "Addition" },
    ]);
    setSearchQuery("");
    setSearchResults([]);
  }

  function removeItem(productId: string) {
    setItems((current) => current.filter((item) => item.productId !== productId));
  }

  function setItemQty(productId: string, qty: number) {
    setItems((current) =>
      current.map((item) => (item.productId === productId ? { ...item, qty: Math.max(1, qty) } : item)),
    );
  }

  function setItemType(productId: string, type: AdjustmentItemType) {
    setItems((current) => current.map((item) => (item.productId === productId ? { ...item, type } : item)));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFieldErrors({});

    const formData = new FormData();
    formData.set("warehouseId", warehouseId);
    formData.set("date", date);
    formData.set(
      "items",
      JSON.stringify(
        items.map((item) => ({
          productId: item.productId,
          quantity: item.qty,
          type: item.type === "Addition" ? "ADDITION" : "SUBTRACTION",
        })),
      ),
    );

    startTransition(async () => {
      const result = await createAdjustment(formData);

      if (result.ok) {
        toast.success("Adjustment saved successfully.");
        router.push("/adjustments");
        router.refresh();
      } else {
        setFieldErrors(result.fieldErrors ?? {});
        toast.error(result.error ?? "Something went wrong.");
      }
    });
  }

  const warehouseOptions = warehouses.map((warehouse) => ({ value: warehouse.id, label: warehouse.name }));

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
            Create Adjustment
          </h1>
          <p style={{ margin: 0, fontSize: 13.5, color: COLORS.slateMid }}>
            Fields marked <span style={{ color: COLORS.danger }}>*</span> are required.
          </p>
        </div>
        <GhostButton href="/adjustments" paddingX={18}>
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
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: "20px 32px" }}>
          <Field label="Warehouse" required error={fieldErrors.warehouseId?.[0]}>
            <SelectInput
              value={warehouseId}
              onChange={handleWarehouseChange}
              placeholder="Choose Warehouse"
              options={warehouseOptions}
              hasError={!!fieldErrors.warehouseId}
            />
          </Field>
          <Field label="Date" required error={fieldErrors.date?.[0]}>
            <input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              style={{
                width: "100%",
                height: 40,
                border: `1px solid ${COLORS.borderStrong}`,
                borderRadius: 8,
                padding: "0 12px",
                fontSize: 14,
                fontFamily: FONTS.mono,
                outline: "none",
              }}
            />
          </Field>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: COLORS.text }}>Product</label>
          <div style={{ position: "relative", maxWidth: 420 }}>
            <Search
              size={15}
              strokeWidth={1.6}
              color={COLORS.slateMid}
              style={{ position: "absolute", left: 12, top: 12 }}
            />
            <input
              placeholder="Search Product by Code Name"
              value={searchQuery}
              disabled={!warehouseId}
              onChange={(event) => setSearchQuery(event.target.value)}
              onFocus={searchFocus.on}
              onBlur={() => setTimeout(searchFocus.off, 150)}
              style={{
                width: "100%",
                height: 40,
                border: `1px solid ${searchFocus.value ? COLORS.teal : COLORS.borderStrong}`,
                borderRadius: 8,
                padding: "0 12px 0 34px",
                fontSize: 14,
                outline: "none",
                background: warehouseId ? "#fff" : COLORS.bgApp,
                color: warehouseId ? COLORS.text : COLORS.slateLight,
                cursor: warehouseId ? "text" : "not-allowed",
                boxShadow: searchFocus.value ? `0 0 0 3px ${COLORS.focusRing}` : "none",
              }}
            />

            {!warehouseId && (
              <span style={{ display: "block", marginTop: 6, fontSize: 12, color: COLORS.slateMid }}>
                Choose a warehouse first to search products.
              </span>
            )}

            {warehouseId && searchFocus.value && searchQuery.trim().length > 0 && (
              <div
                style={{
                  position: "absolute",
                  top: 44,
                  left: 0,
                  right: 0,
                  zIndex: 20,
                  background: "#fff",
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: 10,
                  boxShadow: "0 8px 24px -6px rgba(23,27,28,.20)",
                  padding: 6,
                  maxHeight: 260,
                  overflowY: "auto",
                }}
              >
                {isSearching && (
                  <div style={{ padding: "10px 10px", fontSize: 13, color: COLORS.slateMid }}>Searching…</div>
                )}
                {!isSearching && searchResults.length === 0 && (
                  <div style={{ padding: "10px 10px", fontSize: 13, color: COLORS.slateMid }}>No products found.</div>
                )}
                {!isSearching &&
                  searchResults.map((result) => (
                    <button
                      key={result.id}
                      type="button"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        addItem(result);
                      }}
                      style={{
                        width: "100%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 12,
                        background: "transparent",
                        border: "none",
                        padding: "9px 10px",
                        borderRadius: 6,
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                        <span style={{ fontSize: 13.5, fontWeight: 500, color: COLORS.text }}>{result.name}</span>
                        <span style={{ fontFamily: FONTS.mono, fontSize: 11.5, color: COLORS.slateMid }}>
                          {result.code}
                        </span>
                      </span>
                      <span style={{ fontFamily: FONTS.mono, fontSize: 12, fontWeight: 600, color: COLORS.slate }}>
                        {result.stock} in stock
                      </span>
                    </button>
                  ))}
              </div>
            )}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: COLORS.text }}>
            Order items <span style={{ color: COLORS.danger }}>*</span>
          </label>
          <div style={{ border: `1px solid ${COLORS.border}`, borderRadius: 12, overflow: "hidden" }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(200px,1.4fr) 160px 130px 180px minmax(180px,1fr) 90px",
                columnGap: 16,
                alignItems: "center",
                padding: "0 20px",
                height: 44,
                background: COLORS.bgInput,
                borderBottom: `1px solid ${COLORS.border}`,
                whiteSpace: "nowrap",
              }}
            >
              {["Product", "Code product", "Stock", "Qty", "Type", "Action"].map((label, i) => (
                <span
                  key={label}
                  style={{
                    fontSize: 11.5,
                    fontWeight: 600,
                    letterSpacing: ".08em",
                    textTransform: "uppercase",
                    color: COLORS.slateMid,
                    textAlign: i === 5 ? "right" : "left",
                  }}
                >
                  {label}
                </span>
              ))}
            </div>

            {items.length === 0 ? (
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
            ) : (
              items.map((item) => {
                const overStock = item.type === "Subtraction" && item.qty > item.stock;

                return (
                  <div
                    key={item.productId}
                    ref={(el) => {
                      rowRefs.current[item.productId] = el;
                    }}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(200px,1.4fr) 160px 130px 180px minmax(180px,1fr) 90px",
                      columnGap: 16,
                      alignItems: "center",
                      padding: "12px 20px",
                      minHeight: 68,
                      borderBottom: `1px solid ${COLORS.bgApp}`,
                    }}
                  >
                    <span style={{ fontSize: 14, fontWeight: 500 }}>{item.name}</span>
                    <span
                      style={{
                        fontFamily: FONTS.mono,
                        fontSize: 12,
                        fontWeight: 500,
                        background: COLORS.bgApp,
                        border: `1px solid ${COLORS.borderStrong}`,
                        color: COLORS.text,
                        padding: "4px 9px",
                        borderRadius: 6,
                        justifySelf: "start",
                      }}
                    >
                      {item.code}
                    </span>
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
                      {item.stock}
                    </span>
                    <span style={{ display: "flex", flexDirection: "column", gap: 4, justifySelf: "start" }}>
                      <span style={{ display: "flex", alignItems: "center" }}>
                        <button
                          type="button"
                          title={`Decrease quantity for ${item.name}`}
                          onClick={() => setItemQty(item.productId, item.qty - 1)}
                          style={{
                            width: 32,
                            height: 32,
                            border: `1px solid ${COLORS.borderStrong}`,
                            background: "#fff",
                            borderRadius: "6px 0 0 6px",
                            cursor: "pointer",
                            color: COLORS.slate,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <Minus size={13} strokeWidth={2} />
                        </button>
                        <input
                          value={item.qty}
                          readOnly
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
                        <button
                          type="button"
                          title={`Increase quantity for ${item.name}`}
                          onClick={() => setItemQty(item.productId, item.qty + 1)}
                          style={{
                            width: 32,
                            height: 32,
                            border: `1px solid ${COLORS.borderStrong}`,
                            background: "#fff",
                            borderRadius: "0 6px 6px 0",
                            cursor: "pointer",
                            color: COLORS.slate,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <Plus size={13} strokeWidth={2} />
                        </button>
                      </span>
                      {overStock && (
                        <span style={{ fontSize: 11, color: COLORS.danger }}>Exceeds stock ({item.stock})</span>
                      )}
                    </span>
                    <SelectInput
                      value={item.type}
                      onChange={(value) => setItemType(item.productId, value as AdjustmentItemType)}
                      options={[
                        { value: "Addition", label: "Addition" },
                        { value: "Subtraction", label: "Subtraction" },
                      ]}
                      placeholder="Choose Type"
                    />
                    <button
                      type="button"
                      title="Remove item"
                      onClick={() => removeItem(item.productId)}
                      style={{
                        justifySelf: "end",
                        width: 34,
                        height: 34,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background: "#fff",
                        border: `1px solid ${COLORS.borderStrong}`,
                        borderRadius: 8,
                        cursor: "pointer",
                        color: COLORS.slate,
                      }}
                    >
                      <Trash2 size={15} strokeWidth={1.8} />
                    </button>
                  </div>
                );
              })
            )}
          </div>
          {fieldErrors.items?.[0] && <span style={{ fontSize: 12, color: COLORS.danger }}>{fieldErrors.items[0]}</span>}
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
          <GhostButton href="/adjustments">Cancel</GhostButton>
          <PrimaryButton type="submit" disabled={isPending} paddingX={24} fontSize={14}>
            {isPending ? "Saving…" : "Save adjustment"}
          </PrimaryButton>
        </div>
      </form>

      {pendingWarehouseId !== null && (
        <ConfirmDeleteModal
          title="Change warehouse?"
          message={`Switching warehouses will clear the ${items.length} item${items.length === 1 ? "" : "s"} already added, since their stock values belong to the current warehouse.`}
          confirmLabel="Clear items"
          pendingLabel="Clearing…"
          tone="primary"
          onCancel={() => setPendingWarehouseId(null)}
          onConfirm={confirmWarehouseChange}
        />
      )}
    </div>
  );
}
