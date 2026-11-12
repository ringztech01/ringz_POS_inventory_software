"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { formatNaira } from "@/lib/format";
import type { CancelReason } from "../../lib/cancelReasons";
import { sentMessage } from "../../lib/kds";
import type { BillSplit } from "../../schemas/bill";
import { applyDiscount, refundBill, removeBillSplit, setServiceCharge, settleBill, splitBill } from "../../server/actions/bill";
import { cancelOrderLine, cancelRestaurantOrder, markOrderLineServed, markOrderLinesServed, sendOrderToKitchen } from "../../server/actions/orders";
import type { BillView } from "../../server/queries/bill";
import type { OrderScreenData, TicketLine } from "../../server/queries/orderScreen";
import type { CancelExtras, CancelOutcome } from "./CancelModal";
import type { DiscountOutcome, DiscountRequest } from "./DiscountModal";
import type { SettleOutcome, SettleRequest } from "./PaymentModal";
import type { RefundOutcome, RefundRequest } from "./RefundModal";
import type { Settled } from "./SettledModal";
import type { SplitOutcome } from "./SplitModal";
import { useOrderChanges } from "./useOrderChanges";
import type { ManagerApproval } from "../pos/useManagerApproval";

const OFFLINE = "Couldn't reach the server. Check the connection and try again.";

// The order's actions as both order screens use them (the dashboard's
// /restaurant/orders/[id] and the touch POS): every change through one
// queue with the order's version (useOrderChanges). Pop-ups that show their
// own refusals (cancel over the waste limit, discount, split, settle, refund)
// get them back instead of a toast.
export function useOrderActions(data: OrderScreenData, bill: BillView) {
  const orderId = data.order.id;
  const { run, saving } = useOrderChanges(data.order.version);
  const router = useRouter();
  const [settled, setSettled] = useState<Settled | null>(null);

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

  // A line's refusals (over the waste limit, a manager's PIN wanted, a wrong
  // PIN) come back to its pop-up or the PIN pad instead of a toast.
  async function cancelLine(line: TicketLine, reason: CancelReason, details: string, extras: CancelExtras & { managerApproval?: ManagerApproval }): Promise<CancelOutcome> {
    const refused: { result?: CancelOutcome } = {};
    const accepted = await run(
      async (version) => {
        const result = await cancelOrderLine({ orderId, version, lineId: line.id, reason, details, wasted: extras.wasted, approval: extras.approval, managerApproval: extras.managerApproval });
        if (!result.ok)
          refused.result = { ok: false, error: result.error, needsApproval: "needsApproval" in result && !!result.needsApproval, needsManager: "needsManager" in result && !!result.needsManager };
        else toast.success(extras.wasted ? `${line.name} cancelled and logged as waste.` : `${line.name} cancelled.`);
        return result;
      },
      { quiet: true },
    );
    return accepted ? { ok: true } : (refused.result ?? { ok: false });
  }

  async function cancelOrder(reason: CancelReason, details: string): Promise<CancelOutcome> {
    const ok = await run((version) => cancelRestaurantOrder({ orderId, version, reason, details }));
    if (ok) toast.success(data.order.tableName ? `Order cancelled. Table ${data.order.tableName} is free.` : "Order cancelled.");
    return ok ? { ok: true } : { ok: false };
  }

  // The discount: refusals (over the limit, a wrong PIN) come back to its pop-up.
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
    return accepted ? { ok: true } : (refused.result ?? { ok: false, error: OFFLINE });
  }

  function serviceCharge(on: boolean) {
    void run((version) => setServiceCharge({ orderId, version, on }));
  }

  // Split: refusals go back to the Split pop-up (its own banner), not a toast;
  // a stale order reloads the screen as every change does.
  async function split(request: BillSplit): Promise<SplitOutcome> {
    const refused: { result?: SplitOutcome } = {};
    const accepted = await run(
      async (version) => {
        const result = await splitBill({ orderId, version, split: request });
        if (result.ok) toast.success("Bill split.");
        else refused.result = { ok: false, error: result.error, stale: "stale" in result && !!result.stale };
        return result;
      },
      { quiet: true },
    );
    return accepted ? { ok: true } : (refused.result ?? { ok: false, error: OFFLINE });
  }

  // Settle (Payment pop-up): refusals come back to the pop-up, not a toast;
  // done, `settled` holds what the Settled dialog shows.
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
            printedOn: result.receiptPrinter ?? null,
            partsLeft: bill.split?.parts.filter((p) => p.status === "OPEN" && p.id !== request.partId).length ?? 0,
          });
        return result;
      },
      { quiet: true },
    );
    return accepted ? { ok: true } : (refused.result ?? { ok: false, error: OFFLINE });
  }

  // Refund (a settled bill): not an order change — the order stays Billed —
  // so straight to the server; refusals come back to the pop-up.
  async function refund(request: RefundRequest & { managerApproval?: ManagerApproval }): Promise<RefundOutcome> {
    try {
      const result = await refundBill({ orderId, ...request });
      if (!result.ok) return { ok: false, error: result.error, needsManager: "needsManager" in result && !!result.needsManager };
      toast.success(`Refunded ${formatNaira(result.amount)} (${result.reference}).${result.returnedToStock ? " Back in stock." : ""}`);
      router.refresh();
      return { ok: true };
    } catch {
      return { ok: false, error: OFFLINE };
    }
  }

  function removeSplit() {
    void run(async (version) => {
      const result = await removeBillSplit({ orderId, version });
      if (result.ok) toast.success("Split removed — the bill is paid as one.");
      return result;
    });
  }

  return { run, saving, send, serve, serveReady, cancelLine, cancelOrder, discount, serviceCharge, split, settle, settled, clearSettled: () => setSettled(null), refund, removeSplit };
}
