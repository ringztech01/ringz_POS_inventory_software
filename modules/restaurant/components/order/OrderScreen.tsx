"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_LINE_QUANTITY } from "../../lib/modifiers";
import { cancelReasonsFor, type CancelReason } from "../../lib/cancelReasons";
import { addOrderLine, editOrderLine, setOrderLineQuantity } from "../../server/actions/orders";
import type { Approver } from "../../server/queries/approvers";
import type { BillView } from "../../server/queries/bill";
import type { RefundView } from "../../server/queries/refund";
import type { MenuCard, OrderScreenData, TicketLine } from "../../server/queries/orderScreen";
import BillPanel from "./BillPanel";
import SettledModal from "./SettledModal";
import RefundModal from "./RefundModal";
import CancelModal, { type CancelExtras, type CancelOutcome } from "./CancelModal";
import MenuPanel from "./MenuPanel";
import ModifierModal from "./ModifierModal";
import Ticket from "./Ticket";
import { useOrderActions } from "./useOrderActions";
import FloorPolling from "../floor/FloorPolling";
import { useManagerApproval, withManager, type ManagerApproval } from "../pos/useManagerApproval";
import type { RefundOutcome, RefundRequest } from "./RefundModal";

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
  waste,
  printers,
  canSettle,
  refundView,
  voidApprovers,
  floorHref,
}: {
  data: OrderScreenData;
  bill: BillView;
  approvers: Approver[];
  // Log Waste: Returned by guest can log the food as waste (with the waste
  // approvers for over the limit); null without it.
  waste: { approvers: Approver[] } | null;
  // The printers this device's pre-bill and receipt go to (null: the
  // browser's print page, as before printers were set up).
  printers: { prebill: string | null; receipt: string | null };
  // The signed-in user has Settle Bill (settles and refunds).
  canSettle: boolean;
  // A settled bill's sale, for the Refund pop-up (null otherwise).
  refundView: RefundView | null;
  // Who can approve a void of a sent line or a refund (Approve Voids &
  // Refunds, with a PIN) — for someone who can't do it themselves.
  voidApprovers: Approver[];
  floorHref: string;
}) {
  const manager = useManagerApproval();
  const voidApproval = useRef<{ lineId: string; approval: ManagerApproval } | null>(null);
  const orderId = data.order.id;
  const actions = useOrderActions(data, bill);
  const { run, saving, settled } = actions;
  const [modal, setModal] = useState<ModalState | null>(null);
  const [cancelling, setCancelling] = useState<CancelState | null>(null);
  const [billing, setBilling] = useState(false);
  const [refunding, setRefunding] = useState(false);
  const closeRefund = useCallback(() => setRefunding(false), []);
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

  // A line's refusals over the waste limit come back to its pop-up; a sent
  // line's void without Approve Voids & Refunds asks for a manager's PIN.
  function submitCancel(reason: CancelReason, details: string, extras: CancelExtras): Promise<CancelOutcome> {
    if (!cancelling) return Promise.resolve({ ok: false });
    if (cancelling.mode === "order") return actions.cancelOrder(reason, details);
    const line = cancelling.line;
    return withManager((managerApproval) => actions.cancelLine(line, reason, details, { ...extras, managerApproval }), {
      needs: (o) => !o.ok && !!o.needsManager,
      settled: (o) => o.ok || !!(!o.ok && o.needsApproval),
      ask: manager.ask,
      title: `Void ${line.name} — a manager's PIN`,
      approvers: voidApprovers,
      known: voidApproval.current?.lineId === line.id ? voidApproval.current.approval : undefined,
      remember: (approval) => (voidApproval.current = { lineId: line.id, approval }),
    });
  }

  // A refund without Approve Voids & Refunds: a manager's PIN.
  function refund(request: RefundRequest): Promise<RefundOutcome> {
    return withManager((managerApproval) => actions.refund({ ...request, managerApproval }), {
      needs: (o) => !o.ok && !!o.needsManager,
      ask: manager.ask,
      title: "Refund — a manager's PIN",
      approvers: voidApprovers,
    });
  }

  function closeSettled() {
    if (settled?.closed) setBilling(false);
    actions.clearSettled();
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
        onSend={actions.send}
        onServe={actions.serve}
        onServeReady={actions.serveReady}
        onCancelLine={(line) => setCancelling({ mode: "line", line })}
        onCancelOrder={() => setCancelling({ mode: "order" })}
        onBill={() => setBilling(true)}
        onRefund={refundView && canSettle ? () => setRefunding(true) : undefined}
        receiptPrinter={printers.receipt}
      />
      {refunding && refundView && (
        <RefundModal title={data.order.tableName ? `Table ${data.order.tableName}` : data.order.ref} view={refundView} onSubmit={refund} onClose={closeRefund} />
      )}
      {billing && (
        <BillPanel
          bill={bill}
          approvers={approvers}
          busy={saving}
          onDiscount={actions.discount}
          onServiceCharge={actions.serviceCharge}
          onSplit={actions.split}
          onRemoveSplit={actions.removeSplit}
          canSettle={canSettle}
          onSettle={actions.settle}
          onClose={closeBill}
          prebillPrinter={printers.prebill}
        />
      )}
      {manager.element}
      {settled && <SettledModal settled={settled} receiptPrinter={printers.receipt} onClose={closeSettled} />}
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
          reasons={cancelReasonsFor(cancelling.mode === "line" ? { served: cancelling.line.kitchenStatus === "SERVED" } : "order")}
          askWasted={!!waste}
          approvers={waste?.approvers ?? []}
          onSubmit={submitCancel}
          onClose={() => setCancelling(null)}
        />
      )}
    </>
  );
}
