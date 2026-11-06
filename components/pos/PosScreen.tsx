"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import {
  Archive,
  Banknote,
  Calculator,
  ChevronDown,
  Gauge,
  Hand,
  House,
  List,
  Maximize,
  Minimize,
  RotateCw,
  ScanLine,
  Search,
  ShoppingBag,
  User,
  UserPlus,
} from "lucide-react";
import { COLORS, FONTS } from "@/components/layout/theme";
import { useToggleState } from "@/components/layout/hooks";
import { formatNaira } from "@/lib/format";
import { computeLine, computeOrder, sumSubtotals, toDecimal } from "@/lib/pricing";
import { lineFromProduct, MAX_QTY, type PurchaseLine } from "@/components/purchases/PurchaseForm";
import PurchaseLineModal, { type PurchaseLineEdit } from "@/components/purchases/PurchaseLineModal";
import { isDecimalInput } from "@/components/purchases/form-fields";
import { createPosSale, loadPosProducts } from "@/app/(pos)/pos/actions";
import type { PosCheckout } from "@/app/(pos)/pos/sale-input";
import type { PosOption, PosProduct } from "@/app/(pos)/pos/types";
import PosButton from "./PosButton";
import PosProductCard from "./PosProductCard";
import PosCartRow, { CART_GRID } from "./PosCartRow";
import PosHeldOrdersModal from "./PosHeldOrdersModal";
import { useHeldOrders, type HeldOrder } from "./held-orders";
import PosPaymentModal, { tenderFor } from "./PosPaymentModal";
import PosSaleCompleteModal, { type CompletedSale } from "./PosSaleCompleteModal";
import PosCalculator from "./PosCalculator";
import { useFullscreen } from "./use-fullscreen";
import { OpenDrawerModal } from "@/components/hardware/OpenDrawerButton";
import CameraScanButton from "@/components/hardware/CameraScanner";
import { useScan } from "@/components/hardware/ScanProvider";
import { postToCustomerDisplay } from "@/lib/hardware/customerDisplay";
import { POS } from "./theme";

const panel: CSSProperties = {
  background: "#fff",
  borderRadius: 16,
  boxShadow: POS.panelShadow,
  minHeight: "calc(100vh - 32px)",
};

const cartHeader: CSSProperties = { fontSize: 12, fontWeight: 700, letterSpacing: ".06em", color: COLORS.slate };

const comingSoon = (tool: string) => () => toast(`${tool} is coming soon.`);

// A POS line starts exactly like a Sales line (the Sales form's own builder):
// the product's selling price and tax, no discount, the default sale unit.
const posLine = (product: PosProduct): PurchaseLine => lineFromProduct({ ...product, cost: "0.00" }, "price", "Pic");

// The full-screen POS (RingzPOS POS.dc.html): the cart on the left, the
// catalog on the right. All state is client-side; the server is called to
// reload the grid for a warehouse and, at Pay Now, createPosSale (the Sales
// module's own sale-saving path).
export default function PosScreen({
  userId,
  canViewSales,
  receiptPrinter,
  drawerPrinter,
  warehouses,
  customers,
  defaultCustomerId,
  categories,
  brands,
  initialWarehouseId,
  initialProducts,
}: {
  // The signed-in user: held orders are kept per user.
  userId: string;
  // Manage Sale: the receipt also links to the sale's details page.
  canViewSales: boolean;
  // The receipt printer for this till (null: the receipt page, as before).
  receiptPrinter: string | null;
  // This till's cash drawer (its printer) when the user has Open Drawer; null: no button.
  drawerPrinter: string | null;
  warehouses: PosOption[];
  customers: PosOption[];
  defaultCustomerId: string;
  categories: PosOption[];
  brands: PosOption[];
  initialWarehouseId: string;
  initialProducts: PosProduct[];
}) {
  const [customerId, setCustomerId] = useState(defaultCustomerId);
  const [warehouseId, setWarehouseId] = useState(initialWarehouseId);
  const [products, setProducts] = useState(initialProducts);
  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [brandId, setBrandId] = useState("");
  const [loading, startLoading] = useTransition();
  // The cart. Lines are the Sales form's PurchaseLine, priced only by
  // lib/pricing.ts (computeLine / computeOrder) — no POS math.
  const [lines, setLines] = useState<PurchaseLine[]>([]);
  const [orderTax, setOrderTax] = useState("");
  const [discount, setDiscount] = useState("");
  const [shipping, setShipping] = useState("");
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const held = useHeldOrders(userId);
  const [showHeld, setShowHeld] = useState(false);
  const [showCalculator, setShowCalculator] = useState(false);
  const [openingDrawer, setOpeningDrawer] = useState(false);
  const fullscreen = useFullscreen();
  const [paying, setPaying] = useState(false);
  const [payPending, startPaying] = useTransition();
  const [payError, setPayError] = useState<string | null>(null);
  const [completed, setCompleted] = useState<CompletedSale | null>(null);
  // Set synchronously on the first confirm: a second click before React
  // re-renders the disabled button is ignored, so one cart is one sale.
  const submitting = useRef(false);
  // Only the latest warehouse request may set the grid.
  const latestRequest = useRef(0);

  // Load a warehouse's grid (its ProductStock figures). `previous` is
  // restored if the load fails during a warehouse switch.
  function loadGrid(next: string, previous?: string) {
    const request = ++latestRequest.current;
    startLoading(async () => {
      const result = await loadPosProducts(next);
      if (request !== latestRequest.current) return;
      if (result.ok) {
        // Lines stay in the cart and are checked against the new grid's stock.
        setProducts(result.products);
      } else {
        toast.error(result.error);
        if (previous !== undefined) setWarehouseId(previous);
      }
    });
  }

  function changeWarehouse(next: string) {
    const previous = warehouseId;
    setWarehouseId(next);
    loadGrid(next, previous);
  }

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return products.filter(
      (product) =>
        (!categoryId || product.categoryId === categoryId) &&
        (!brandId || product.brandId === brandId) &&
        (!needle || product.name.toLowerCase().includes(needle) || product.code.toLowerCase().includes(needle)),
    );
  }, [products, query, categoryId, brandId]);

  // Live totals — the same lib/pricing.ts createSale re-runs on the server.
  const subtotals = lines.map((line) => computeLine(line).subtotal);
  const order = computeOrder({ itemsTotal: sumSubtotals(subtotals), taxRate: orderTax, discount, shipping });
  const totalQty = lines.reduce((sum, line) => sum + line.quantity, 0);
  const editingLine = lines.find((line) => line.productId === editingProductId) ?? null;

  // Stock hints (UX only — createSale's check at payment is the real one):
  // what the selected warehouse holds, from the grid's ProductStock figures.
  const stockById = useMemo(() => new Map(products.map((product) => [product.id, product.stock])), [products]);
  const available = (productId: string) => stockById.get(productId) ?? 0;
  const warehouseName = warehouses.find((warehouse) => warehouse.id === warehouseId)?.name ?? "this warehouse";
  const overStock = lines.filter((line) => line.quantity > available(line.productId));

  // A product tap: a new line, or one more of a line already in the cart —
  // never past what the warehouse holds.
  function addProduct(product: PosProduct) {
    const inCart = lines.find((line) => line.productId === product.id)?.quantity ?? 0;
    if (inCart + 1 > product.stock) {
      toast.error(
        product.stock <= 0
          ? `${product.name} is out of stock in ${warehouseName}.`
          : `Only ${product.stock} ${product.unitName} of ${product.name} in stock in ${warehouseName}.`,
      );
      return;
    }
    setLines((current) =>
      current.some((line) => line.productId === product.id)
        ? current.map((line) =>
            line.productId === product.id ? { ...line, quantity: Math.min(MAX_QTY, line.quantity + 1) } : line,
          )
        : [...current, posLine(product)],
    );
  }

  // Stepper / typed quantity: 1 … available (as the Sales form caps it). A
  // line already over stock (after a warehouse switch) snaps down to what's
  // available on its next change.
  function setQuantity(productId: string, quantity: number) {
    const cap = Math.min(MAX_QTY, Math.max(1, available(productId)));
    setLines((current) =>
      current.map((line) => (line.productId === productId ? { ...line, quantity: Math.max(1, Math.min(quantity, cap)) } : line)),
    );
  }

  function saveLineEdit(edit: PurchaseLineEdit) {
    setLines((current) => current.map((line) => (line.productId === editingProductId ? { ...line, ...edit } : line)));
    setEditingProductId(null);
  }

  function removeLine(productId: string) {
    setLines((current) => current.filter((line) => line.productId !== productId));
  }

  // Reset: an empty cart (customer and warehouse stay).
  function resetCart() {
    setLines([]);
    setOrderTax("");
    setDiscount("");
    setShipping("");
  }

  // Hold: save this cart (customer, warehouse, lines, order inputs) and start
  // a new one for the walk-in customer. No Sale, no stock change.
  function holdCart() {
    if (lines.length === 0) return;
    held.hold({ customerId, warehouseId, lines, orderTax, discount, shipping });
    resetCart();
    setCustomerId(defaultCustomerId);
    toast.success("Order put on hold.");
  }

  // Resume: the held cart comes back exactly as it was (and leaves the list).
  // Anything already in the cart is held first, so nothing is lost.
  function resumeOrder(order: HeldOrder) {
    if (lines.length > 0) held.hold({ customerId, warehouseId, lines, orderTax, discount, shipping });
    held.remove(order.id);

    const customerExists = customers.some((customer) => customer.id === order.customerId);
    setCustomerId(customerExists ? order.customerId : defaultCustomerId);
    if (order.warehouseId !== warehouseId) {
      if (warehouses.some((warehouse) => warehouse.id === order.warehouseId)) changeWarehouse(order.warehouseId);
      else toast.error("That order's warehouse no longer exists — its lines are checked against this one.");
    }
    setLines(order.lines);
    setOrderTax(order.orderTax);
    setDiscount(order.discount);
    setShipping(order.shipping);
    setShowHeld(false);
    toast.success(lines.length > 0 ? "Order resumed — the previous cart is now on hold." : "Order resumed.");
    if (!customerExists) toast.error("That order's customer no longer exists — switched to the walk-in customer.");
  }

  // Pay Now → createPosSale. Success: clear the cart (back to the walk-in),
  // show the reference, change and receipt, and reload the grid (stock just
  // went down). Failure (e.g. someone else sold the stock): keep the cart,
  // show the server's message and reload the grid so the lines it can't
  // cover are flagged.
  function pay({ received, paymentType }: { received: string; paymentType: PosCheckout["paymentType"] }) {
    if (submitting.current) return;
    submitting.current = true;
    setPayError(null);

    const grandTotal = order.grandTotal.toFixed(2);
    const tender = tenderFor(grandTotal, received);
    const checkout: PosCheckout = {
      customerId,
      warehouseId,
      orderTax,
      discount,
      shipping,
      paidAmount: tender.paid.toFixed(2),
      paymentType,
      lines: lines.map((line) => ({
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

    startPaying(async () => {
      try {
        const result = await createPosSale(checkout);
        if (result.ok && result.id && result.reference) {
          setCompleted({
            id: result.id,
            reference: result.reference,
            total: grandTotal,
            paid: tender.paid.toFixed(2),
            change: tender.change.toFixed(2),
            paymentStatus: tender.paymentStatus,
          });
          setPaying(false);
          resetCart();
          setCustomerId(defaultCustomerId);
        } else {
          // POS has no form fields to point at, so the specific reason (e.g.
          // "Customer not found.") beats the generic "fix the errors below".
          const fieldError = Object.values(result.fieldErrors ?? {}).flat()[0];
          const message = fieldError ?? result.error ?? "The sale couldn't be completed.";
          setPayError(message);
          toast.error(message);
        }
        loadGrid(warehouseId);
      } catch {
        setPayError("Couldn't reach the server. The sale was not completed — try again.");
      } finally {
        submitting.current = false;
      }
    });
  }

  // Enter in the search box (a scanner sends the code + Enter): add the
  // product whose code matches exactly, or the only one shown.
  function addFromSearch() {
    const needle = query.trim().toLowerCase();
    if (!needle) return;
    const match =
      products.find((product) => product.code.toLowerCase() === needle) ?? (visible.length === 1 ? visible[0] : null);
    if (!match) return;
    addProduct(match);
    setQuery("");
  }

  // A barcode scan (or the camera) while no text field has focus: the product
  // with that code joins the cart. Paused while a pop-up is open.
  const popupOpen = paying || !!completed || showHeld || showCalculator || openingDrawer || !!editingProductId;
  useScan(
    (code) => {
      const match = products.find((product) => product.code.toLowerCase() === code.toLowerCase());
      if (!match) {
        toast.error(`No product with code ${code} in ${warehouseName}.`);
        return;
      }
      addProduct(match);
    },
    { enabled: !popupOpen },
  );

  // The customer display (a stub — /pos/display on a second screen): the cart as it is.
  useEffect(() => {
    if (completed) return;
    postToCustomerDisplay(
      lines.length === 0
        ? { kind: "idle" }
        : { kind: "cart", lines: lines.map((line, i) => ({ name: line.name, quantity: line.quantity, total: formatNaira(subtotals[i].toFixed(2)) })), total: formatNaira(order.grandTotal.toFixed(2)) },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the totals follow `lines` and the order fields
  }, [lines, orderTax, discount, shipping, completed]);
  useEffect(() => {
    if (completed) postToCustomerDisplay({ kind: "done", total: formatNaira(completed.total), paid: formatNaira(completed.paid), change: formatNaira(completed.change) });
  }, [completed]);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "620px minmax(0,1fr)",
        gap: 16,
        padding: 16,
        minHeight: "100vh",
        alignItems: "start",
      }}
    >
      {/* ===== LEFT: CART ===== */}
      <section style={{ ...panel, display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", gap: 12, padding: "16px 16px 0" }}>
          <CustomerBox customers={customers} value={customerId} onChange={setCustomerId} />
          <WarehouseSelect warehouses={warehouses} value={warehouseId} onChange={changeWarehouse} />
        </div>

        <div style={{ padding: "20px 20px 0" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: CART_GRID,
              columnGap: 8,
              alignItems: "center",
              paddingBottom: 14,
              borderBottom: `1px solid ${COLORS.border}`,
            }}
          >
            <span style={cartHeader}>PRODUCT</span>
            <span style={{ ...cartHeader, textAlign: "center" }}>QTY</span>
            <span style={cartHeader}>PRICE</span>
            <span style={cartHeader}>SUB TOTAL</span>
            <span />
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "4px 20px 20px" }}>
          {lines.length === 0 ? (
            <div style={{ padding: "48px 0", textAlign: "center", fontSize: 14, color: COLORS.slateLight }}>
              Cart is empty — tap a product to add it.
            </div>
          ) : (
            lines.map((line, i) => (
              <PosCartRow
                key={line.productId}
                line={line}
                subtotal={subtotals[i].toFixed(2)}
                available={available(line.productId)}
                onQuantity={(quantity) => setQuantity(line.productId, quantity)}
                onEdit={() => setEditingProductId(line.productId)}
                onRemove={() => removeLine(line.productId)}
              />
            ))
          )}
        </div>

        <div style={{ padding: "0 20px 20px" }}>
          {overStock.length > 0 && (
            <div
              role="status"
              style={{
                marginBottom: 16,
                padding: "10px 14px",
                borderRadius: 10,
                background: COLORS.dangerBg,
                border: `1px solid ${COLORS.dangerBorder}`,
                fontSize: 13.5,
                color: COLORS.danger,
              }}
            >
              {overStock.length === 1 ? "1 line is" : `${overStock.length} lines are`} more than {warehouseName} has in stock.
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1.1fr)", gap: 24, alignItems: "end" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <AdornedInput
                placeholder="Tax"
                adornment="%"
                value={orderTax}
                onChange={setOrderTax}
                error={toDecimal(orderTax).greaterThan(100) ? "Order tax can't be more than 100%." : undefined}
              />
              <AdornedInput
                placeholder="Discount"
                adornment="₦"
                value={discount}
                onChange={setDiscount}
                // computeOrder caps it at the sub total; say so.
                error={toDecimal(discount).greaterThan(order.itemsTotal) ? "Discount is more than the sub total." : undefined}
              />
              <AdornedInput placeholder="Shipping" adornment="₦" value={shipping} onChange={setShipping} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end", textAlign: "right" }}>
              <SummaryLine label="Total QTY" value={totalQty.toLocaleString("en-NG")} />
              <SummaryLine label="Sub Total" value={formatNaira(order.itemsTotal.toFixed(2))} />
              <span style={{ fontFamily: FONTS.display, fontSize: 26, fontWeight: 700, letterSpacing: "-.01em" }}>
                Total : {formatNaira(order.grandTotal.toFixed(2))}
              </span>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 14, marginTop: 20 }}>
            <ActionButton
              icon={<Hand size={19} strokeWidth={1.5} />}
              label="Hold"
              color={POS.rose}
              hover={POS.roseHover}
              disabled={lines.length === 0}
              onClick={holdCart}
            />
            <ActionButton
              icon={<RotateCw size={18} strokeWidth={1.5} />}
              label="Reset"
              color={POS.red}
              hover={POS.redHover}
              disabled={lines.length === 0 && !orderTax && !discount && !shipping}
              onClick={resetCart}
            />
            <ActionButton
              icon={<Banknote size={20} strokeWidth={1.5} />}
              label="Pay Now"
              color={POS.green}
              hover={POS.greenHover}
              // Not while any line is over stock (the red note says why).
              disabled={lines.length === 0 || overStock.length > 0 || loading}
              onClick={() => {
                setPayError(null);
                setPaying(true);
              }}
            />
          </div>
        </div>
      </section>

      {/* ===== RIGHT: CATALOG ===== */}
      <section style={{ ...panel, padding: 16, display: "flex", flexDirection: "column", gap: 20 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <SearchBox value={query} onChange={setQuery} onEnter={addFromSearch} />
          <ToolButton title="Order list" color={POS.rose} hover={POS.roseHover} onClick={() => setShowHeld(true)}>
            <List size={22} strokeWidth={1.6} />
            <span
              style={{
                position: "absolute",
                top: -6,
                right: -6,
                minWidth: 22,
                height: 22,
                padding: "0 6px",
                borderRadius: 999,
                background: POS.indigo,
                color: "#fff",
                fontSize: 12,
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: "2px solid #fff",
              }}
            >
              {held.orders.length}
            </span>
          </ToolButton>
          <ToolButton title="Bag" color={POS.green} hover={POS.greenHover} onClick={comingSoon("Bag")}>
            <ShoppingBag size={22} strokeWidth={1.5} />
          </ToolButton>
          <ToolButton
            title={fullscreen.active ? "Exit fullscreen" : "Fullscreen"}
            color={POS.indigo}
            hover={POS.indigoHover}
            onClick={fullscreen.toggle}
          >
            {fullscreen.active ? <Minimize size={21} strokeWidth={1.6} /> : <Maximize size={21} strokeWidth={1.6} />}
          </ToolButton>
          <CameraScanButton
            render={(open) => (
              <ToolButton title="Scan with the camera" color={POS.indigo} hover={POS.indigoHover} onClick={open}>
                <ScanLine size={21} strokeWidth={1.5} />
              </ToolButton>
            )}
          />
          {drawerPrinter && (
            <ToolButton title="Open drawer" color={POS.indigo} hover={POS.indigoHover} onClick={() => setOpeningDrawer(true)}>
              <Archive size={21} strokeWidth={1.5} />
            </ToolButton>
          )}
          <ToolButton title="Calculator" color={POS.indigo} hover={POS.indigoHover} onClick={() => setShowCalculator((open) => !open)}>
            <Calculator size={21} strokeWidth={1.5} />
          </ToolButton>
          {/* No sidebar here: the gauge is the way back. */}
          <DashboardLink />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <ChipRow allLabel="All Categories" options={categories} value={categoryId} onChange={setCategoryId} />
          <ChipRow allLabel="All Brands" options={brands} value={brandId} onChange={setBrandId} />
        </div>

        <div
          aria-busy={loading}
          style={{ opacity: loading ? 0.5 : 1, transition: "opacity .12s", pointerEvents: loading ? "none" : "auto" }}
        >
          {visible.length === 0 ? (
            <div style={{ padding: "56px 0", textAlign: "center", fontSize: 14, color: COLORS.slateMid }}>
              {products.length === 0 ? "No products yet." : "No products match."}
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5,minmax(0,1fr))", gap: 16 }}>
              {visible.map((product) => (
                <PosProductCard key={product.id} product={product} onSelect={() => addProduct(product)} />
              ))}
            </div>
          )}
        </div>
      </section>

      {showCalculator && <PosCalculator onClose={() => setShowCalculator(false)} />}

      {openingDrawer && drawerPrinter && <OpenDrawerModal printer={drawerPrinter} onClose={() => setOpeningDrawer(false)} />}

      {paying && (
        <PosPaymentModal
          grandTotal={order.grandTotal.toFixed(2)}
          pending={payPending}
          error={payError}
          blocked={overStock.length > 0 ? `${overStock.length === 1 ? "1 line is" : `${overStock.length} lines are`} more than ${warehouseName} has in stock — lower or remove ${overStock.length === 1 ? "it" : "them"} first.` : null}
          onConfirm={pay}
          onClose={() => setPaying(false)}
        />
      )}

      {completed && <PosSaleCompleteModal sale={completed} canViewSales={canViewSales} receiptPrinter={receiptPrinter} onClose={() => setCompleted(null)} />}

      {showHeld && (
        <PosHeldOrdersModal
          orders={held.orders}
          customers={customers}
          warehouses={warehouses}
          onResume={resumeOrder}
          onDiscard={held.remove}
          onClose={() => setShowHeld(false)}
        />
      )}

      {editingLine && (
        // The Sales form's own line dialog (price, tax, discount, unit).
        <PurchaseLineModal
          line={editingLine}
          priceField="price"
          unitLabel="Sale unit"
          onClose={() => setEditingProductId(null)}
          onSave={saveLineEdit}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- pieces

const focusRing = (focused: boolean): CSSProperties =>
  focused ? { borderColor: COLORS.teal, boxShadow: `0 0 0 3px ${COLORS.focusRing}` } : {};

// The customer "box": the selected customer's name (a select), plus the design's
// Add customer button.
function CustomerBox({ customers, value, onChange }: { customers: PosOption[]; value: string; onChange: (id: string) => void }) {
  const focus = useToggleState();
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        gap: 12,
        height: 64,
        border: `1px solid ${COLORS.border}`,
        borderRadius: 12,
        padding: "0 8px 0 16px",
        minWidth: 0,
        ...focusRing(focus.value),
      }}
    >
      <User size={18} strokeWidth={1.5} color={COLORS.slate} style={{ flex: "0 0 auto" }} />
      <select
        aria-label="Customer"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={focus.on}
        onBlur={focus.off}
        style={{
          flex: 1,
          minWidth: 0,
          appearance: "none",
          border: "none",
          background: "transparent",
          fontSize: 16,
          fontWeight: 600,
          color: COLORS.ink,
          outline: "none",
          cursor: "pointer",
          textOverflow: "ellipsis",
        }}
      >
        {customers.map((customer) => (
          <option key={customer.id} value={customer.id}>
            {customer.name}
          </option>
        ))}
      </select>
      <PosButton
        title="Add customer"
        onClick={comingSoon("Adding a customer from POS")}
        style={{
          width: 48,
          height: 48,
          flex: "0 0 auto",
          borderRadius: 10,
          background: POS.indigo,
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
        hoverStyle={{ background: POS.indigoHover }}
      >
        <UserPlus size={19} strokeWidth={1.5} />
      </PosButton>
    </div>
  );
}

function WarehouseSelect({ warehouses, value, onChange }: { warehouses: PosOption[]; value: string; onChange: (id: string) => void }) {
  const focus = useToggleState();
  return (
    <div style={{ position: "relative", width: 230 }}>
      <House
        size={17}
        strokeWidth={1.5}
        color={COLORS.slate}
        style={{ position: "absolute", left: 14, top: 23, pointerEvents: "none" }}
      />
      <select
        aria-label="Warehouse"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={focus.on}
        onBlur={focus.off}
        style={{
          appearance: "none",
          width: "100%",
          height: 64,
          border: `1px solid ${COLORS.border}`,
          borderRadius: 12,
          padding: "0 40px",
          fontSize: 16,
          fontWeight: 600,
          background: "#fff",
          color: COLORS.ink,
          cursor: "pointer",
          outline: "none",
          ...focusRing(focus.value),
        }}
      >
        {warehouses.length === 0 && <option value="">No warehouses</option>}
        {warehouses.map((warehouse) => (
          <option key={warehouse.id} value={warehouse.id}>
            {warehouse.name}
          </option>
        ))}
      </select>
      <ChevronDown
        size={15}
        strokeWidth={1.7}
        color={COLORS.slateMid}
        style={{ position: "absolute", right: 16, top: 25, pointerEvents: "none" }}
      />
    </div>
  );
}

// Tax % / Discount ₦ / Shipping ₦: decimals only (the Sales form's rule);
// `error` turns the box red with the reason as its tooltip.
function AdornedInput({
  placeholder,
  adornment,
  value,
  onChange,
  error,
}: {
  placeholder: string;
  adornment: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
}) {
  const focus = useToggleState();
  return (
    <div style={{ position: "relative" }}>
      <input
        placeholder={placeholder}
        aria-label={placeholder}
        aria-invalid={!!error}
        title={error}
        inputMode="decimal"
        value={value}
        onChange={(e) => {
          if (isDecimalInput(e.target.value)) onChange(e.target.value);
        }}
        onFocus={focus.on}
        onBlur={focus.off}
        style={{
          width: "100%",
          height: 52,
          border: `1px solid ${error ? COLORS.danger : COLORS.border}`,
          borderRadius: 12,
          padding: "0 44px 0 16px",
          fontSize: 15,
          outline: "none",
          background: "#fff",
          ...(focus.value && !error ? focusRing(true) : null),
          ...(error ? { boxShadow: `0 0 0 3px ${COLORS.dangerBg}` } : null),
        }}
      />
      <span
        style={{
          position: "absolute",
          right: 16,
          top: 16,
          fontSize: adornment === "%" ? 14 : 13,
          fontWeight: 600,
          color: COLORS.slateLight,
        }}
      >
        {adornment}
      </span>
    </div>
  );
}

function SummaryLine({ label, value }: { label: string; value: string }) {
  return (
    <span style={{ fontSize: 19, fontWeight: 500, color: COLORS.slate }}>
      {label} : <span style={{ fontWeight: 700, color: COLORS.ink }}>{value}</span>
    </span>
  );
}

function ActionButton({
  icon,
  label,
  color,
  hover,
  disabled,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  color: string;
  hover: string;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <PosButton
      onClick={onClick}
      disabled={disabled}
      style={{
        height: 60,
        borderRadius: 12,
        background: color,
        color: "#fff",
        fontSize: 16,
        fontWeight: 600,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
      }}
      hoverStyle={{ background: hover }}
    >
      {icon}
      {label}
    </PosButton>
  );
}

function SearchBox({ value, onChange, onEnter }: { value: string; onChange: (value: string) => void; onEnter: () => void }) {
  const focus = useToggleState();
  return (
    <div style={{ position: "relative", flex: 1 }}>
      <Search
        size={20}
        strokeWidth={1.6}
        color={COLORS.slateLight}
        style={{ position: "absolute", left: 18, top: 20, pointerEvents: "none" }}
      />
      <input
        placeholder="Scan/Search Product by Code Name"
        aria-label="Search products"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onEnter();
          }
        }}
        onFocus={focus.on}
        onBlur={focus.off}
        style={{
          width: "100%",
          height: 60,
          border: "none",
          background: focus.value ? "#fff" : POS.searchBg,
          boxShadow: focus.value ? `0 0 0 2px ${COLORS.focusRing}` : "none",
          borderRadius: 12,
          padding: "0 20px 0 50px",
          fontSize: 17,
          color: COLORS.slate,
          outline: "none",
        }}
      />
    </div>
  );
}

const toolStyle = (background: string): CSSProperties => ({
  position: "relative",
  width: 60,
  height: 60,
  flex: "0 0 auto",
  borderRadius: 12,
  background,
  color: "#fff",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
});

function ToolButton({
  title,
  color,
  hover,
  onClick,
  children,
}: {
  title: string;
  color: string;
  hover: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <PosButton title={title} aria-label={title} onClick={onClick} style={toolStyle(color)} hoverStyle={{ background: hover }}>
      {children}
    </PosButton>
  );
}

function DashboardLink() {
  const hover = useToggleState();
  return (
    <Link
      href="/dashboard"
      title="Dashboard"
      aria-label="Dashboard"
      onMouseEnter={hover.on}
      onMouseLeave={hover.off}
      style={{ ...toolStyle(hover.value ? POS.indigoHover : POS.indigo), textDecoration: "none" }}
    >
      <Gauge size={21} strokeWidth={1.5} />
    </Link>
  );
}

// "All …" plus one chip per option; the active chip is solid indigo.
function ChipRow({
  allLabel,
  options,
  value,
  onChange,
}: {
  allLabel: string;
  options: PosOption[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div role="group" aria-label={allLabel} style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
      {[{ id: "", name: allLabel }, ...options].map((option) => {
        const active = option.id === value;
        return (
          <PosButton
            key={option.id || "all"}
            aria-pressed={active}
            onClick={() => onChange(option.id)}
            style={{
              height: 48,
              padding: "0 24px",
              borderRadius: 12,
              background: active ? POS.indigo : POS.chip,
              color: active ? "#fff" : COLORS.slate,
              fontSize: 15,
              fontWeight: 600,
            }}
            hoverStyle={{ background: active ? POS.indigoHover : POS.chipHover }}
          >
            {option.name}
          </PosButton>
        );
      })}
    </div>
  );
}
