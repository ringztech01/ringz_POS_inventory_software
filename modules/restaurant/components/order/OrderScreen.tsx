"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MAX_LINE_QUANTITY } from "../../lib/modifiers";
import toast from "react-hot-toast";
import { formatNaira } from "@/lib/format";
import type { CancelReason } from "../../lib/cancelReasons";
import {
  addOrderLine,
  cancelOrderLine,
  cancelRestaurantOrder,
  editOrderLine,
  markOrderLineServed,
  markOrderLinesServed,
  sendOrderToKitchen,
  setOrderLineQuantity,
} from "../../server/actions/orders";
import type { BillSplit } from "../../schemas/bill";
import { applyDiscount, refundBill, removeBillSplit, setServiceCharge, settleBill, splitBill } from "../../server/actions/bill";
import type { Approver } from "../../server/queries/approvers";
import type { BillView } from "../../server/queries/bill";
import type { RefundView } from "../../server/queries/refund";
import type { MenuCard, OrderScreenData, TicketLine } from "../../server/queries/orderScreen";
import BillPanel from "./BillPanel";
import type { DiscountOutcome, DiscountRequest } from "./DiscountModal";
import type { SettleOutcome, SettleRequest } from "./PaymentModal";
import SettledModal, { type Settled } from "./SettledModal";
import RefundModal, { type RefundOutcome, type RefundRequest } from "./RefundModal";
import CancelModal from "./CancelModal";
import MenuPanel from "./MenuPanel";
import ModifierModal from "./ModifierModal";
import Ticket from "./Ticket";
import { useOrderChanges } from "./useOrderChanges";
import { sentMessage } from "../../lib/kds";
import FloorPolling from "../floor/FloorPolling";

type ModalState =
  | { mode: "add"; productId: string; title: string }
  | { mode: "edit"; lineId: string; productId: string; title: string; initial: { modifierIds: string[]; note: string } };

type CancelState = { mode: "line"; line: TicketLine } | { mode: "order" };

// A value typed on the screen ahead of the server: shown while the server's
// value is still `base`; once the page brings the server's new value it
// takes over (no flicker back in between).
export type Pending<V> = { value: V; base: V };

const STEPPER_DELAY = 300;

// /restaurant/orders/[id] — the menu (left) and the ticket (right). Tapping
// a dish adds it (or opens its options); the stepper shows a new quantity at
// once and saves it 300 ms after the last tap. Every change goes through one
// queue with the order's version; all money comes back from the server.
export default function OrderScreen({
  data,
  bill,
  approvers,
  canSettle,
  refundView,
  floorHref,
}: {
  data: OrderScreenData;
  bill: BillView;
  approvers: Approver[];
  // The signed-in user has Settle Bill (settles and refunds).
  canSettle: boolean;
  // A settled bill's sale, for the Refund pop-up (null otherwise).
  refundView: RefundView | null;
  floorHref: string;
}) {
  const orderId = data.order.id;
  const { run, saving } = useOrderChanges(data.order.version);
  const [modal, setModal] = useState<ModalState | null>(null);
  const [cancelling, setCancelling] = useState<CancelState | null>(null);
  const [billing, setBilling] = useState(false);
  const [settled, setSettled] = useState<Settled | null>(null);
  const [refunding, setRefunding] = useState(false);
  const closeRefund = useCallback(() => setRefunding(false), []);
  const router = useRouter();
  const closeBill = useCallback(() => setBilling(false), []);
  const [quantities, setQuantities] = useState<Record<string, Pending<number>>>({});
  // Stepper saves waiting for their 300 ms, by line.
  const timers = useRef(new Map<string, { handle: ReturnType<typeof setTimeout>; send: () => void }>());

  // Leaving with a stepper change still waiting: send it now.
  useEffect(() => {
    const waiting = timers.current;
    return () =>
      waiting.forEach(({ handle, send }) => {
        clearTimeout(handle);
        send();
      });
  }, []);

  function pick(item: MenuCard) {
    if (item.hasOptions) setModal({ mode: "add", productId: item.id, title: item.name });
    else void run((version) => addOrderLine({ orderId, version, productId: item.id, modifierIds: [], note: "" }));
  }

  function edit(line: TicketLine) {
    setModal({ mode: "edit", lineId: line.id, productId: line.productId, title: line.name, initial: { modifierIds: line.modifierIds, note: line.note ?? "" } });
  }

  function submitModal(modifierIds: string[], note: string): Promise<boolean> {
    if (!modal) return Promise.resolve(false);
    return modal.mode === "add"
      ? run((version) => addOrderLine({ orderId, version, productId: modal.productId, modifierIds, note }))
      : run((version) => editOrderLine({ orderId, version, lineId: modal.lineId, modifierIds, note }));
  }

  function shownQuantity(line: TicketLine) {
    const pending = quantities[line.id];
    return pending && pending.base === line.quantity ? pending.value : line.quantity;
  }

  // The newest stepper value per line, kept in step with `quantities` from
  // event handlers — so taps quicker than a re-render still each count, and
  // the delayed save sends the value as it is when it fires.
  const latest = useRef<Record<string, Pending<number>>>({});

  function forget(lineId: string) {
    const rest = { ...latest.current };
    delete rest[lineId];
    latest.current = rest;
    setQuantities(rest);
  }

  // One tap on the stepper: +1 or −1 (0 removes the line).
  function step(line: TicketLine, delta: 1 | -1) {
    const pending = latest.current[line.id];
    const from = pending && pending.base === line.quantity ? pending.value : line.quantity;
    const next = Math.max(0, Math.min(MAX_LINE_QUANTITY, from + delta));
    latest.current = { ...latest.current, [line.id]: { value: next, base: line.quantity } };
    setQuantities(latest.current);

    const send = () => {
      timers.current.delete(line.id);
      const quantity = latest.current[line.id]?.value ?? next;
      void run((version) => setOrderLineQuantity({ orderId, version, lineId: line.id, quantity })).then((accepted) => {
        // Refused: back to the server's quantity.
        if (!accepted) forget(line.id);
      });
    };
    const waiting = timers.current.get(line.id);
    if (waiting) clearTimeout(waiting.handle);
    timers.current.set(line.id, { handle: setTimeout(send, STEPPER_DELAY), send });
  }

  function send() {
    void run(async (version) => {
      const result = await sendOrderToKitchen({ orderId, version });
      const message = result.ok ? sentMessage(result.sent) : null;
      if (message) toast.success(message);
      return result;
    });
  }

  function serve(line: TicketLine) {
    void run((version) => markOrderLineServed({ orderId, version, lineId: line.id }));
  }

  // The Ready bar: everything the kitchen has finished, at once.
  function serveReady(ready: TicketLine[]) {
    void run(async (version) => {
      const result = await markOrderLinesServed({ orderId, version, lineIds: ready.map((line) => line.id) });
      if (result.ok) toast.success(ready.length === 1 ? `${ready[0].name} served.` : `${ready.length} lines served.`);
      return result;
    });
  }

  function submitCancel(reason: CancelReason, details: string): Promise<boolean> {
    if (!cancelling) return Promise.resolve(false);
    if (cancelling.mode === "line") {
      const { line } = cancelling;
      return run((version) => cancelOrderLine({ orderId, version, lineId: line.id, reason, details })).then((ok) => {
        if (ok) toast.success(`${line.name} cancelled.`);
        return ok;
      });
    }
    return run((version) => cancelRestaurantOrder({ orderId, version, reason, details })).then((ok) => {
      if (ok) toast.success(data.order.tableName ? `Order cancelled. Table ${data.order.tableName} is free.` : "Order cancelled.");
      return ok;
    });
  }

  // The Bill panel's discount: refusals (over the limit, a wrong PIN) come
  // back to its pop-up instead of a toast.
  async function discount(request: DiscountRequest): Promise<DiscountOutcome> {
    const refused: { result?: DiscountOutcome } = {};
    const accepted = await run(
      async (version) => {
        const result = await applyDiscount({ orderId, version, ...request });
        if (!result.ok) refused.result = { ok: false, error: result.error, needsApproval: "needsApproval" in result };
        else toast.success(Number(request.value) === 0 ? "Discount removed." : "Discount applied.");
        return result;
      },
      { quiet: true },
    );
    return accepted ? { ok: true } : (refused.result ?? { ok: false, error: "Couldn't reach the server. Check the connection and try again." });
  }

  function serviceCharge(on: boolean) {
    void run((version) => setServiceCharge({ orderId, version, on }));
  }

  function split(request: BillSplit): Promise<boolean> {
    return run(async (version) => {
      const result = await splitBill({ orderId, version, split: request });
      if (result.ok) toast.success("Bill split.");
      return result;
    });
  }

  // Settle (Payment pop-up): refusals come back to the pop-up, not a toast;
  // done, the Settled dialog shows the change and the receipt.
  async function settle(request: SettleRequest): Promise<SettleOutcome> {
    const refused: { result?: SettleOutcome } = {};
    const part = bill.split?.parts.find((p) => p.id === request.partId);
    const accepted = await run(
      async (version) => {
        const result = await settleBill({ orderId, version, ...request });
        if (!result.ok) refused.result = { ok: false, error: result.error };
        else
          setSettled({
            saleId: result.saleId,
            reference: result.reference,
            closed: result.closed,
            paid: result.paid,
            change: result.change,
            title: part?.label ?? "Bill",
            partsLeft: (bill.split?.parts.filter((p) => p.status === "OPEN" && p.id !== request.partId).length ?? 0),
          });
        return result;
      },
      { quiet: true },
    );
    return accepted ? { ok: true } : (refused.result ?? { ok: false, error: "Couldn't reach the server. Check the connection and try again." });
  }

  function closeSettled() {
    if (settled?.closed) setBilling(false);
    setSettled(null);
  }

  // Refund (a settled bill): not an order change — the order stays Billed —
  // so straight to the server; refusals come back to the pop-up.
  async function refund(request: RefundRequest): Promise<RefundOutcome> {
    try {
      const result = await refundBill({ orderId, ...request });
      if (!result.ok) return { ok: false, error: result.error };
      toast.success(`Refunded ${formatNaira(result.amount)} (${result.reference}).${result.returnedToStock ? " Back in stock." : ""}`);
      router.refresh();
      return { ok: true };
    } catch {
      return { ok: false, error: "Couldn't reach the server. Check the connection and try again." };
    }
  }

  function removeSplit() {
    void run(async (version) => {
      const result = await removeBillSplit({ orderId, version });
      if (result.ok) toast.success("Split removed — the bill is paid as one.");
      return result;
    });
  }

  const typing = data.lines.some((line) => {
    const pending = quantities[line.id];
    return pending && pending.base === line.quantity && pending.value !== line.quantity;
  });

  return (
    <>
      {/* Kitchen progress (Ready lines) shows up without a reload. */}
      <FloorPolling />
      <MenuPanel menu={data.menu} floorHref={floorHref} editable={data.order.editable} onPick={pick} />
      <Ticket
        data={data}
        run={run}
        busy={saving || typing}
        shownQuantity={shownQuantity}
        onStep={step}
        onEdit={edit}
        onSend={send}
        onServe={serve}
        onServeReady={serveReady}
        onCancelLine={(line) => setCancelling({ mode: "line", line })}
        onCancelOrder={() => setCancelling({ mode: "order" })}
        onBill={() => setBilling(true)}
        onRefund={refundView && canSettle ? () => setRefunding(true) : undefined}
      />
      {refunding && refundView && (
        <RefundModal title={data.order.tableName ? `Table ${data.order.tableName}` : data.order.ref} view={refundView} onSubmit={refund} onClose={closeRefund} />
      )}
      {billing && (
        <BillPanel
          bill={bill}
          approvers={approvers}
          busy={saving}
          onDiscount={discount}
          onServiceCharge={serviceCharge}
          onSplit={split}
          onRemoveSplit={removeSplit}
          canSettle={canSettle}
          onSettle={settle}
          onClose={closeBill}
        />
      )}
      {settled && <SettledModal settled={settled} onClose={closeSettled} />}
      {modal && (
        <ModifierModal
          title={modal.title}
          groups={data.modifierGroups[modal.productId] ?? []}
          initial={modal.mode === "edit" ? modal.initial : null}
          submitLabel={modal.mode === "add" ? "Add to order" : "Save changes"}
          onSubmit={submitModal}
          onClose={() => setModal(null)}
        />
      )}
      {cancelling && (
        <CancelModal
          title={cancelling.mode === "line" ? `Cancel ${cancelling.line.name}?` : `Cancel ${data.order.ref}?`}
          message={
            cancelling.mode === "line"
              ? "It stays on the ticket, crossed out and left out of the total. Why is it being cancelled?"
              : "The order closes and its table is free again. Why is it being cancelled?"
          }
          confirmLabel={cancelling.mode === "line" ? "Cancel line" : "Cancel order"}
          onSubmit={submitCancel}
          onClose={() => setCancelling(null)}
        />
      )}
    </>
  );
}
