"use client";

import { useRef, useState, useTransition, type ChangeEvent, type DragEvent, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { ArrowLeft, ChevronDown, ImagePlus, X } from "lucide-react";
import { useToggleState } from "@/components/layout/hooks";
import { COLORS, FONTS } from "@/components/layout/theme";
import PrimaryButton from "@/components/ui/PrimaryButton";
import GhostButton from "@/components/ui/GhostButton";
import { STOCK_STATUS_OPTIONS } from "@/lib/validations/product";
import { createProduct, updateProduct } from "@/app/(dashboard)/products/actions";
import type { FormOption, ProductEditData, ProductFieldName, StockBreakdownRow } from "@/app/(dashboard)/products/types";

const TAX_TYPE_OPTIONS = [
  { value: "EXCLUSIVE", label: "Exclusive" },
  { value: "INCLUSIVE", label: "Inclusive" },
];

type FieldErrors = Partial<Record<ProductFieldName, string[]>>;

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

function TextInput({
  name,
  value,
  onChange,
  placeholder,
  mono,
  hasError,
}: {
  name: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  mono?: boolean;
  hasError?: boolean;
}) {
  const focus = useToggleState();

  return (
    <input
      name={name}
      placeholder={placeholder}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onFocus={focus.on}
      onBlur={focus.off}
      style={{
        height: 40,
        border: `1px solid ${hasError ? COLORS.danger : focus.value ? COLORS.teal : COLORS.borderStrong}`,
        borderRadius: 8,
        padding: "0 12px",
        fontSize: 14,
        outline: "none",
        fontFamily: mono ? FONTS.mono : undefined,
        boxShadow: focus.value ? `0 0 0 3px ${COLORS.focusRing}` : "none",
        transition: "border-color .12s, box-shadow .12s",
      }}
    />
  );
}

function SuffixedInput({
  name,
  value,
  onChange,
  suffix,
  placeholder,
  hasError,
}: {
  name: string;
  value: string;
  onChange: (value: string) => void;
  suffix: string;
  placeholder?: string;
  hasError?: boolean;
}) {
  const focus = useToggleState();

  return (
    <div style={{ display: "flex" }}>
      <input
        name={name}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={focus.on}
        onBlur={focus.off}
        style={{
          flex: 1,
          height: 40,
          borderTop: `1px solid ${hasError ? COLORS.danger : focus.value ? COLORS.teal : COLORS.borderStrong}`,
          borderBottom: `1px solid ${hasError ? COLORS.danger : focus.value ? COLORS.teal : COLORS.borderStrong}`,
          borderLeft: `1px solid ${hasError ? COLORS.danger : focus.value ? COLORS.teal : COLORS.borderStrong}`,
          borderRight: "none",
          borderRadius: "8px 0 0 8px",
          padding: "0 12px",
          fontSize: 14,
          fontFamily: FONTS.mono,
          outline: "none",
          minWidth: 0,
        }}
      />
      <span
        style={{
          height: 40,
          display: "flex",
          alignItems: "center",
          padding: "0 14px",
          background: COLORS.bgApp,
          border: `1px solid ${COLORS.borderStrong}`,
          borderRadius: "0 8px 8px 0",
          fontSize: 13,
          fontWeight: 600,
          color: COLORS.slate,
        }}
      >
        {suffix}
      </span>
    </div>
  );
}

function SelectInput({
  name,
  value,
  onChange,
  options,
  placeholder,
  hasError,
}: {
  name: string;
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
        name={name}
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

function ImageDropzone({
  existingImages,
  onExistingImageRemoved,
  files,
  onFilesAdded,
  onFileRemoved,
}: {
  existingImages: string[];
  onExistingImageRemoved: (url: string) => void;
  files: File[];
  onFilesAdded: (files: File[]) => void;
  onFileRemoved: (index: number) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dragging = useToggleState();

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files) {
      onFilesAdded(Array.from(event.target.files));
      event.target.value = "";
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    dragging.off();
    if (event.dataTransfer.files) {
      onFilesAdded(Array.from(event.dataTransfer.files));
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <label style={{ fontSize: 13, fontWeight: 600, color: COLORS.text }}>Multiple image</label>
      <div
        onDragOver={(event) => {
          event.preventDefault();
          dragging.on();
        }}
        onDragLeave={dragging.off}
        onDrop={handleDrop}
        style={{
          border: `1.5px dashed ${dragging.value ? COLORS.teal : "#c3cacc"}`,
          borderRadius: 10,
          padding: 22,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 10,
          background: dragging.value ? COLORS.tealTint : COLORS.bgInput,
          transition: "background .12s, border-color .12s",
        }}
      >
        <span
          style={{
            width: 40,
            height: 40,
            borderRadius: 11,
            background: COLORS.tealTint,
            color: COLORS.teal,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <ImagePlus size={19} strokeWidth={1.8} />
        </span>
        <span style={{ fontFamily: FONTS.mono, fontSize: 11.5, color: COLORS.slateMid }}>
          drop product shots · png / jpg
        </span>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          style={{
            height: 34,
            padding: "0 14px",
            background: "#fff",
            border: `1px solid ${COLORS.borderStrong}`,
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            color: COLORS.text,
            cursor: "pointer",
          }}
        >
          Choose files
        </button>
        <span style={{ fontSize: 12, color: COLORS.slateLight }}>
          {existingImages.length + files.length === 0
            ? "No file chosen"
            : `${existingImages.length + files.length} file${existingImages.length + files.length === 1 ? "" : "s"} chosen`}
        </span>
        <input ref={inputRef} type="file" accept="image/*" multiple onChange={handleChange} style={{ display: "none" }} />
      </div>

      {(existingImages.length > 0 || files.length > 0) && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          {existingImages.map((url) => (
            <div key={url} style={{ position: "relative", width: 56, height: 56 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt=""
                style={{ width: 56, height: 56, borderRadius: 8, objectFit: "cover", border: `1px solid ${COLORS.border}` }}
              />
              <button
                type="button"
                title="Remove image"
                onClick={() => onExistingImageRemoved(url)}
                style={{
                  position: "absolute",
                  top: -6,
                  right: -6,
                  width: 20,
                  height: 20,
                  borderRadius: 999,
                  border: `1px solid ${COLORS.borderStrong}`,
                  background: "#fff",
                  cursor: "pointer",
                  color: COLORS.danger,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 0,
                }}
              >
                <X size={11} strokeWidth={2} />
              </button>
            </div>
          ))}
          {files.map((file, index) => {
            const previewUrl = URL.createObjectURL(file);
            return (
              <div key={`${file.name}-${index}`} style={{ position: "relative", width: 56, height: 56 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={previewUrl}
                  alt=""
                  onLoad={() => URL.revokeObjectURL(previewUrl)}
                  style={{ width: 56, height: 56, borderRadius: 8, objectFit: "cover", border: `1px solid ${COLORS.border}` }}
                />
                <button
                  type="button"
                  title="Remove image"
                  onClick={() => onFileRemoved(index)}
                  style={{
                    position: "absolute",
                    top: -6,
                    right: -6,
                    width: 20,
                    height: 20,
                    borderRadius: 999,
                    border: `1px solid ${COLORS.borderStrong}`,
                    background: "#fff",
                    cursor: "pointer",
                    color: COLORS.danger,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: 0,
                  }}
                >
                  <X size={11} strokeWidth={2} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Read-only in edit mode: the create-time "Add stock" fields are replaced by
// this summary so that saving an edit can never re-insert a ProductStock row
// (which would silently inflate stock on every save). Real stock changes go
// through Adjustments/Purchases once those modules exist.
function StockSummary({ breakdown }: { breakdown: StockBreakdownRow[] }) {
  const total = breakdown.reduce((sum, row) => sum + row.quantity, 0);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        padding: 20,
        background: COLORS.bgInput,
        border: `1px solid ${COLORS.border}`,
        borderRadius: 12,
      }}
    >
      <h3 style={{ margin: 0, fontFamily: FONTS.display, fontSize: 18, fontWeight: 600 }}>Stock</h3>

      {breakdown.length === 0 ? (
        <span style={{ fontSize: 13, color: COLORS.slateMid }}>No stock recorded yet.</span>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto",
              fontSize: 11.5,
              fontWeight: 600,
              letterSpacing: ".06em",
              textTransform: "uppercase",
              color: COLORS.slateMid,
            }}
          >
            <span>Warehouse</span>
            <span>Quantity</span>
          </div>
          {breakdown.map((row) => (
            <div key={row.warehouseId} style={{ display: "grid", gridTemplateColumns: "1fr auto", fontSize: 13.5 }}>
              <span>{row.warehouseName}</span>
              <span style={{ fontFamily: FONTS.mono, fontWeight: 600 }}>{row.quantity}</span>
            </div>
          ))}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto",
              fontSize: 13.5,
              fontWeight: 700,
              paddingTop: 8,
              borderTop: `1px solid ${COLORS.border}`,
            }}
          >
            <span>Total</span>
            <span style={{ fontFamily: FONTS.mono }}>{total}</span>
          </div>
        </div>
      )}

      <p style={{ margin: 0, fontSize: 12, color: COLORS.slateMid, lineHeight: 1.5 }}>
        Stock changes go through Adjustments/Purchases, not this form.
      </p>
    </div>
  );
}

export default function ProductForm({
  mode = "create",
  product,
  stockBreakdown = [],
  categories,
  brands,
  units,
  warehouses,
  suppliers,
}: {
  mode?: "create" | "edit";
  product?: ProductEditData;
  stockBreakdown?: StockBreakdownRow[];
  categories: FormOption[];
  brands: FormOption[];
  units: FormOption[];
  warehouses: FormOption[];
  suppliers: FormOption[];
}) {
  const router = useRouter();
  const isEdit = mode === "edit" && !!product;
  const [isPending, startTransition] = useTransition();
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const [name, setName] = useState(product?.name ?? "");
  const [code, setCode] = useState(product?.code ?? "");
  const [categoryId, setCategoryId] = useState(product?.categoryId ?? "");
  const [brandId, setBrandId] = useState(product?.brandId ?? "");
  const [price, setPrice] = useState(product ? String(product.price) : "");
  const [cost, setCost] = useState(product?.cost ?? "");
  const [unitId, setUnitId] = useState(product?.unitId ?? "");
  const [stockAlert, setStockAlert] = useState(product?.stockAlert != null ? String(product.stockAlert) : "");
  const [orderTax, setOrderTax] = useState(product?.orderTax != null ? String(product.orderTax) : "");
  const [taxType, setTaxType] = useState(product?.taxType ?? "");
  const [quantityLimitation, setQuantityLimitation] = useState(
    product?.quantityLimitation != null ? String(product.quantityLimitation) : "",
  );
  const [notes, setNotes] = useState(product?.notes ?? "");

  // Only used in create mode — see the stock panel below.
  const [warehouseId, setWarehouseId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [status, setStatus] = useState("");

  const [existingImages, setExistingImages] = useState<string[]>(product?.images ?? []);
  const [imageFiles, setImageFiles] = useState<File[]>([]);

  function addImageFiles(files: File[]) {
    setImageFiles((current) => [...current, ...files]);
  }

  function removeImageFile(index: number) {
    setImageFiles((current) => current.filter((_, i) => i !== index));
  }

  function removeExistingImage(url: string) {
    setExistingImages((current) => current.filter((existing) => existing !== url));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    imageFiles.forEach((file) => formData.append("images", file));
    if (isEdit) {
      // Tells the server which previously-saved images survived editing —
      // it reconciles this with any newly uploaded files into the final list.
      formData.append("existingImages", JSON.stringify(existingImages));
    }
    setFieldErrors({});

    startTransition(async () => {
      const result = isEdit ? await updateProduct(product!.id, formData) : await createProduct(formData);

      if (result.ok) {
        toast.success(isEdit ? "Product updated successfully." : "Product created successfully.");
        router.push("/products");
        router.refresh();
      } else {
        setFieldErrors(result.fieldErrors ?? {});
        toast.error(result.error ?? "Something went wrong.");
      }
    });
  }

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
            {isEdit ? "Edit Product" : "Create Product"}
          </h1>
          <p style={{ margin: 0, fontSize: 13.5, color: COLORS.slateMid }}>
            Fields marked <span style={{ color: COLORS.danger }}>*</span> are required.
          </p>
        </div>
        <GhostButton href="/products" paddingX={18}>
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
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr) minmax(320px,0.9fr)",
            gap: "20px 32px",
          }}
        >
          <Field label="Name" required error={fieldErrors.name?.[0]}>
            <TextInput
              name="name"
              value={name}
              onChange={setName}
              placeholder="Enter Name"
              hasError={!!fieldErrors.name}
            />
          </Field>
          <Field label="Code" required error={fieldErrors.code?.[0]}>
            <TextInput
              name="code"
              value={code}
              onChange={setCode}
              placeholder="Enter Code"
              mono
              hasError={!!fieldErrors.code}
            />
          </Field>

          <div
            style={{
              gridRow: "1 / span 6",
              display: "flex",
              flexDirection: "column",
              gap: 20,
              paddingLeft: 32,
              borderLeft: `1px solid ${COLORS.border}`,
            }}
          >
            <ImageDropzone
              existingImages={existingImages}
              onExistingImageRemoved={removeExistingImage}
              files={imageFiles}
              onFilesAdded={addImageFiles}
              onFileRemoved={removeImageFile}
            />

            {isEdit ? (
              <StockSummary breakdown={stockBreakdown} />
            ) : (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 16,
                  padding: 20,
                  background: COLORS.bgInput,
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: 12,
                }}
              >
                <h3 style={{ margin: 0, fontFamily: FONTS.display, fontSize: 18, fontWeight: 600 }}>Add stock</h3>
                <Field label="Warehouse" required error={fieldErrors.warehouseId?.[0]}>
                  <SelectInput
                    name="warehouseId"
                    value={warehouseId}
                    onChange={setWarehouseId}
                    placeholder="Choose Warehouse"
                    options={warehouses.map((w) => ({ value: w.id, label: w.name }))}
                    hasError={!!fieldErrors.warehouseId}
                  />
                </Field>
                <Field label="Supplier" required error={fieldErrors.supplierId?.[0]}>
                  <SelectInput
                    name="supplierId"
                    value={supplierId}
                    onChange={setSupplierId}
                    placeholder="Choose Supplier"
                    options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
                    hasError={!!fieldErrors.supplierId}
                  />
                </Field>
                <Field label="Add product quantity" required error={fieldErrors.quantity?.[0]}>
                  <TextInput
                    name="quantity"
                    value={quantity}
                    onChange={setQuantity}
                    placeholder="Add Product Quantity"
                    mono
                    hasError={!!fieldErrors.quantity}
                  />
                </Field>
                <Field label="Status" required error={fieldErrors.status?.[0]}>
                  <SelectInput
                    name="status"
                    value={status}
                    onChange={setStatus}
                    placeholder="Choose Status"
                    options={STOCK_STATUS_OPTIONS.map((s) => ({ value: s, label: s }))}
                    hasError={!!fieldErrors.status}
                  />
                </Field>
              </div>
            )}
          </div>

          <Field label="Product category" required error={fieldErrors.categoryId?.[0]}>
            <SelectInput
              name="categoryId"
              value={categoryId}
              onChange={setCategoryId}
              placeholder="Choose Product Category"
              options={categories.map((c) => ({ value: c.id, label: c.name }))}
              hasError={!!fieldErrors.categoryId}
            />
          </Field>
          <Field label="Brand" required error={fieldErrors.brandId?.[0]}>
            <SelectInput
              name="brandId"
              value={brandId}
              onChange={setBrandId}
              placeholder="Choose Brand"
              options={brands.map((b) => ({ value: b.id, label: b.name }))}
              hasError={!!fieldErrors.brandId}
            />
          </Field>

          <Field label="Product price" required error={fieldErrors.price?.[0]}>
            <SuffixedInput
              name="price"
              value={price}
              onChange={setPrice}
              suffix="₦"
              placeholder="Enter Product Price"
              hasError={!!fieldErrors.price}
            />
          </Field>
          <Field label="Product cost" error={fieldErrors.cost?.[0]}>
            <SuffixedInput
              name="cost"
              value={cost}
              onChange={setCost}
              suffix="₦"
              placeholder="Enter Product Cost"
              hasError={!!fieldErrors.cost}
            />
          </Field>

          <Field label="Product unit" required error={fieldErrors.unitId?.[0]}>
            <SelectInput
              name="unitId"
              value={unitId}
              onChange={setUnitId}
              placeholder="Choose Product Unit"
              options={units.map((u) => ({ value: u.id, label: u.name }))}
              hasError={!!fieldErrors.unitId}
            />
          </Field>

          <Field label="Stock alert" error={fieldErrors.stockAlert?.[0]}>
            <TextInput
              name="stockAlert"
              value={stockAlert}
              onChange={setStockAlert}
              placeholder="0"
              mono
              hasError={!!fieldErrors.stockAlert}
            />
          </Field>
          <Field label="Order tax" error={fieldErrors.orderTax?.[0]}>
            <SuffixedInput
              name="orderTax"
              value={orderTax}
              onChange={setOrderTax}
              suffix="%"
              placeholder="0"
              hasError={!!fieldErrors.orderTax}
            />
          </Field>

          <Field label="Tax type" required error={fieldErrors.taxType?.[0]}>
            <SelectInput
              name="taxType"
              value={taxType}
              onChange={setTaxType}
              placeholder="Choose Tax Type"
              options={TAX_TYPE_OPTIONS}
              hasError={!!fieldErrors.taxType}
            />
          </Field>
          <Field label="Quantity limitation" error={fieldErrors.quantityLimitation?.[0]}>
            <TextInput
              name="quantityLimitation"
              value={quantityLimitation}
              onChange={setQuantityLimitation}
              placeholder="Enter Quantity Limitation"
              hasError={!!fieldErrors.quantityLimitation}
            />
          </Field>

          <div style={{ gridColumn: "1 / span 2", display: "flex", flexDirection: "column", gap: 8 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: COLORS.text }}>Notes</label>
            <textarea
              name="notes"
              placeholder="Enter Notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              style={{
                minHeight: 110,
                border: `1px solid ${COLORS.borderStrong}`,
                borderRadius: 8,
                padding: "10px 12px",
                fontSize: 14,
                outline: "none",
                resize: "vertical",
                fontFamily: FONTS.body,
              }}
            />
            {fieldErrors.notes?.[0] && <span style={{ fontSize: 12, color: COLORS.danger }}>{fieldErrors.notes[0]}</span>}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 12,
            marginTop: 28,
            paddingTop: 24,
            borderTop: `1px solid ${COLORS.border}`,
          }}
        >
          <GhostButton href="/products">Cancel</GhostButton>
          <PrimaryButton type="submit" disabled={isPending} paddingX={24} fontSize={14}>
            {isPending ? "Saving…" : "Save product"}
          </PrimaryButton>
        </div>
      </form>
    </div>
  );
}
