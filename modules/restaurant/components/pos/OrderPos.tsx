"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { useScan } from "@/components/hardware/ScanProvider";
import PrintButton from "@/components/hardware/PrintButton";
import { cancelReasonsFor, type CancelReason } from "../../lib/cancelReasons";
import { sentMessage } from "../../lib/kds";
import { MAX_LINE_QUANTITY } from "../../lib/modifiers";
import { needsOptions, optionNames, type FlowGroup } from "../../lib/optionFlow";
import { COURSE_LABEL, findByCode, heldGroups, placeLabel, sendChoices, sendsInOneGo, type Course } from "../../lib/posSpeed";
import { noTableLabel } from "../../lib/orderLines";
import { TOUCH } from "../../lib/theme";
import { addOrderLine, editOrderLine, holdOrderLines, placeOrderLines, sendOrderToKitchen, setOrderLineQuantity } from "../../server/actions/orders";
import { printBillAction, printReceiptAction } from "../../server/actions/printing";
import type { Approver } from "../../server/queries/approvers";
import type { BillView } from "../../server/queries/bill";
import type { MenuCard, OrderScreenData, TicketLine } from "../../server/queries/orderScreen";
import type { RefundView } from "../../server/queries/refund";
import type { OrderChangeResult } from "../../server/services/orders";
import BillPanel from "../order/BillPanel";
import CancelModal, { type CancelExtras, type CancelOutcome } from "../order/CancelModal";
import PaymentModal from "../order/PaymentModal";
import GuestLinesPanel from "../order/GuestLinesPanel";
import ReadyToServe from "../order/ReadyToServe";
import RefundModal, { type RefundOutcome, type RefundRequest } from "../order/RefundModal";
import type { DiscountOutcome, DiscountRequest } from "../order/DiscountModal";
import SettledModal from "../order/SettledModal";
import SplitModal from "../order/SplitModal";
import { useOrderActions } from "../order/useOrderActions";
import FloorPolling from "../floor/FloorPolling";
import CheckPanel, { LineStrip, type PendingLine } from "./CheckPanel";
import FunctionBar, { type FnKey } from "./FunctionBar";
import MenuPad from "./MenuPad";
import MoreMenu from "./MoreMenu";
import NotePanel from "./NotePanel";
import OptionsPanel from "./OptionsPanel";
import QtyPanel from "./QtyPanel";
import SearchPanel from "./SearchPanel";
import SeatPanel from "./SeatPanel";
import SendPanel from "./SendPanel";
import TouchButton from "./TouchButton";
import PanelFrame, { doneKey } from "./PanelFrame";
import { withManager, type ManagerApproval } from "./useManagerApproval";
import PosFrame from "./PosFrame";
import PosHeader from "./PosHeader";
import type { PosCan } from "./RestaurantPos";
import { usePosSession } from "./PosSession";
import { useServiceRoutes } from "../ServiceRoutes";
import { routesFor } from "../../lib/serviceRoutes";


type Popup =
  | { kind: "cancelLine"; line: TicketLine }
  | { kind: "cancelOrder" }
  | { kind: "bill" }
  | { kind: "split" }
  | { kind: "pay" }
  | { kind: "refund" };

// Dishes tapped but not yet on the server's check: shown at once, until the
// page brings the order at (or past) the version that added them.
type Tapped = PendingLine & { course: Course | null; doneAt: number | null };
let tapCount = 0;

// Over the item grid: a new dish's options, a line's options, its note.
type Panel =
  | { kind: "add"; item: MenuCard }
  | { kind: "options"; line: TicketLine }
  | { kind: "note"; line: TicketLine }
  | { kind: "qty"; initial: string }
  | { kind: "seat" }
  | { kind: "send" }
  | { kind: "search" }
  // Void a line not sent yet: one tap to say yes.
  | { kind: "confirmVoid"; line: TicketLine };

// A quantity stepped with −1 / +1, shown at once (0: off the check).
type Stepped = { lineId: string; quantity: number; doneAt: number | null };

// A seat, course or hold changed on lines, shown at once.
type Patch = { lineIds: string[]; patch: Partial<Pick<TicketLine, "seat" | "course" | "held">>; doneAt: number | null };

// A line's options or note changed here, shown at once until the page
// brings the order at (or past) the version that saved it.
type Edited = { lineId: string; options: string[]; note: string | null; doneAt: number | null };

// The touch POS with an order loaded (/pos?order=…): the check, the menu pad
// and the function bar over the same actions as the order screen
// (useOrderActions). A dish tap shows on the check at once and saves in the
// background; money is always the server's.
export default function OrderPos({
  data,
  bill,
  approvers,
  waste,
  printers,
  canSettle,
  refundView,
  voidApprovers,
  can,
  returnHome,
  sendToFloor,
  quickNotes,
  openPay = false,
}: {
  data: OrderScreenData;
  bill: BillView;
  approvers: Approver[];
  waste: { approvers: Approver[] } | null;
  printers: { prebill: string | null; receipt: string | null };
  canSettle: boolean;
  refundView: RefundView | null;
  // Who can approve a void of a sent line or a refund (the manager PIN pad).
  voidApprovers: Approver[];
  // What this user may open (hidden otherwise).
  can: PosCan;
  // After a dish is added: back to the department's home (a setting).
  returnHome: boolean;
  // After Send: back to the floor plan (a setting).
  sendToFloor: boolean;
  // The Note keypad's quick notes (Food › POS buttons).
  quickNotes: string[];
  // Opened with Pay from the tables screen: the payment comes up at once.
  openPay?: boolean;
}) {
  const router = useRouter();
  const session = usePosSession();
  const { order, lines, totals, waiters } = data;
  const orderId = order.id;
  const actions = useOrderActions(data, bill);
  const { run, saving, settled } = actions;
  const [popup, setPopup] = useState<Popup | null>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  // Back on the crumb bar while a panel is open: the panel's own (a step
  // back in the options; keep the note), else it just closes.
  const panelBack = useRef<(() => void) | null>(null);
  const [edited, setEdited] = useState<Edited[]>([]);
  const closePanel = useCallback(() => setPanel(null), []);
  const [more, setMore] = useState(false);
  const [tapped, setTapped] = useState<Tapped[]>([]);
  const [removing, setRemoving] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [stepped, setStepped] = useState<Stepped[]>([]);
  const [patches, setPatches] = useState<Patch[]>([]);
  // Qty first: the next dish goes on this many times.
  const [nextQuantity, setNextQuantity] = useState<number | null>(null);
  // Seat & course with no line picked: for the next dishes rung up.
  const [nextPlace, setNextPlace] = useState<{ seat: number | null; course: Course | null }>({ seat: null, course: null });
  const closePopup = useCallback(() => setPopup(null), []);
  const closeMore = useCallback(() => setMore(false), []);

  // The newest line: the last one that appeared or grew since the last render
  // of the server's lines (a repeat tap merges into the same line).
  const [seen, setSeen] = useState(lines);
  const [newest, setNewest] = useState<string | null>(null);
  if (seen !== lines) {
    const before = new Map(seen.map((line) => [line.id, line.quantity]));
    const grown = lines.filter((line) => !line.cancelled && line.quantity > (before.get(line.id) ?? 0)).at(-1);
    setSeen(lines);
    if (grown) setNewest(grown.id);
  }

  const routes = useServiceRoutes();
  useEffect(() => {
    router.prefetch(routes.tables());
  }, [router, routes]);

  const pending = tapped.filter((t) => t.doneAt === null || order.version < t.doneAt);
  const edits = edited.filter((e) => e.doneAt === null || order.version < e.doneAt);
  const steps = stepped.filter((e) => e.doneAt === null || order.version < e.doneAt);
  const livePatches = patches.filter((e) => e.doneAt === null || order.version < e.doneAt);
  const shownLines = lines
    .filter((line) => !removing.includes(line.id))
    .map((line) => {
      const edit = edits.findLast((e) => e.lineId === line.id);
      const step = steps.findLast((e) => e.lineId === line.id);
      const patched = livePatches.filter((e) => e.lineIds.includes(line.id)).reduce((all, e) => ({ ...all, ...e.patch }), {});
      return { ...line, ...(edit ? { options: edit.options, note: edit.note } : {}), ...(step ? { quantity: step.quantity } : {}), ...patched };
    })
    .filter((line) => line.quantity > 0);
  const selected = shownLines.find((line) => line.id === selectedId) ?? null;
  const highlightKey = pending.at(-1)?.key ?? newest;
  const closedMessage = order.status === "BILLED" ? "This bill is settled — the order can't change." : "This order is cancelled.";
  const waiter = waiters.find((w) => w.id === order.waiterId)?.name ?? null;

  const groupsOf = (productId: string): FlowGroup[] => data.modifierGroups[productId] ?? [];
  const colourOf = (productId: string) => data.menu.tree.groups[data.menu.tree.dishGroup[productId]]?.colour ?? TOUCH.key;

  // On the check at once (with its options), saved in the background.
  // Qty first and the next dishes' seat / course apply; Repeat sends its own.
  function add(item: { id: string; name: string; price: string }, modifierIds: string[], copy?: { note: string | null; seat: number | null; course: Course | null }) {
    const key = `tap-${++tapCount}`;
    const options = optionNames(groupsOf(item.id), modifierIds);
    const quantity = copy ? 1 : (nextQuantity ?? 1);
    const { seat, course } = copy ?? nextPlace;
    const note = copy?.note ?? "";
    if (!copy) setNextQuantity(null);
    setTapped((list) => [...list.filter((t) => t.doneAt === null || order.version < t.doneAt), { key, name: item.name, price: item.price, options, quantity, place: placeLabel(seat, course), course, doneAt: null }]);
    void run(async (version) => {
      const result = await addOrderLine({ orderId, version, productId: item.id, modifierIds, note, quantity, seat, course });
      if (result.ok) setTapped((list) => list.map((t) => (t.key === key ? { ...t, doneAt: result.version } : t)));
      return result;
    }).then((accepted) => {
      if (!accepted) setTapped((list) => list.filter((t) => t.key !== key));
    });
  }

  // A tap: a required group opens the options panel; otherwise it's added.
  function pick(item: MenuCard) {
    if (!order.editable) return void toast.error(closedMessage);
    if (needsOptions(groupsOf(item.id))) return setPanel({ kind: "add", item });
    setPanel(null);
    add(item, []);
  }

  // A long press: the options panel even when they're all optional.
  function longPick(item: MenuCard) {
    if (!order.editable) return void toast.error(closedMessage);
    if (groupsOf(item.id).length) setPanel({ kind: "add", item });
  }

  // A line's options or note: shown at once, saved in the background.
  function editLine(line: TicketLine, modifierIds: string[], note: string) {
    const entry: Edited = { lineId: line.id, options: optionNames(groupsOf(line.productId), modifierIds), note: note || null, doneAt: null };
    setEdited((list) => [...list.filter((e) => e.doneAt === null || order.version < e.doneAt), entry]);
    void run(async (version) => {
      const result = await editOrderLine({ orderId, version, lineId: line.id, modifierIds, note });
      if (result.ok) setEdited((list) => list.map((e) => (e === entry ? { ...e, doneAt: result.version } : e)));
      return result;
    }).then((accepted) => {
      if (!accepted) setEdited((list) => list.filter((e) => e !== entry));
    });
  }

  // A sent line's void: a manager's PIN unless this user has Approve Voids &
  // Refunds (the pad over the screen asks); a waste approval may follow in
  // the pop-up, so the manager's PIN is kept for that second try.
  const voidApproval = useRef<{ lineId: string; approval: ManagerApproval } | null>(null);
  async function submitCancel(reason: CancelReason, details: string, extras: CancelExtras): Promise<CancelOutcome> {
    if (popup?.kind === "cancelOrder") return actions.cancelOrder(reason, details);
    if (popup?.kind !== "cancelLine") return { ok: false };
    const line = popup.line;
    return withManager((managerApproval) => actions.cancelLine(line, reason, details, { ...extras, managerApproval }), {
      needs: (o) => !o.ok && !!o.needsManager,
      settled: (o) => o.ok || !!(!o.ok && o.needsApproval),
      ask: session.askManager,
      title: `Void ${line.name} — a manager's PIN`,
      approvers: voidApprovers,
      known: voidApproval.current?.lineId === line.id ? voidApproval.current.approval : undefined,
      remember: (approval) => (voidApproval.current = { lineId: line.id, approval }),
    });
  }

  // A refund: a manager's PIN unless this user has Approve Voids & Refunds.
  function refund(request: RefundRequest): Promise<RefundOutcome> {
    return withManager((managerApproval) => actions.refund({ ...request, managerApproval }), {
      needs: (o) => !o.ok && !!o.needsManager,
      ask: session.askManager,
      title: "Refund — a manager's PIN",
      approvers: voidApprovers,
    });
  }

  // A discount over the limit: an approver's PIN on the pad (not in the pop-up).
  function discount(request: DiscountRequest): Promise<DiscountOutcome> {
    return withManager((approval) => actions.discount({ ...request, approval: approval ?? request.approval }), {
      needs: (o) => !o.ok && !!o.needsApproval,
      ask: session.askManager,
      title: "A discount over the limit — an approver's PIN",
      approvers,
    });
  }

  function voidLine() {
    if (!selected) return void toast("Tap the line to void on the check first.");
    if (selected.cancelled) return void toast(`${selected.name} is already void.`);
    if (selected.editable) return setPanel({ kind: "confirmVoid", line: selected });
    if (selected.canCancel) return setPopup({ kind: "cancelLine", line: selected });
    toast(`${selected.name} can't be voided.`);
  }

  // Not sent yet: it just comes off the check (said yes to first).
  function removeLine(line: TicketLine) {
    setPanel(null);
    setRemoving((ids) => [...ids, line.id]);
    setSelectedId(null);
    void run((version) => setOrderLineQuantity({ orderId, version, lineId: line.id, quantity: 0 })).then((accepted) => {
      if (!accepted) setRemoving((ids) => ids.filter((id) => id !== line.id));
    });
  }

  // Note: the picked line, else the newest line not sent yet.
  function note() {
    const newestLine = shownLines.find((line) => line.id === newest && line.editable);
    const line = selected ?? newestLine;
    if (!line) return void toast(pending.length ? "Still saving — one moment." : "Tap a line on the check first.");
    if (!line.editable) return void toast("Notes go on lines that haven't been sent.");
    setPanel({ kind: "note", line });
  }

  const splitLocked = !!bill.split?.parts.some((part) => part.status === "PAID");
  function split() {
    if (saving) return void toast("Still saving — one moment.");
    if (splitLocked) return setPopup({ kind: "bill" });
    if (bill.settleBlocker) return void toast.error(bill.settleBlocker);
    setPopup({ kind: "split" });
  }

  function pay() {
    if (saving) return void toast("Still saving — one moment.");
    if (bill.split) return setPopup({ kind: "bill" });
    if (bill.settleBlocker) return void toast.error(bill.settleBlocker);
    setPopup({ kind: "pay" });
  }

  // ---- Speed tools (Part 6e Step 4)

  // −1 / +1 on a line not sent yet (0 takes it off); a sent line: +1 repeats it.
  function step(line: TicketLine, delta: 1 | -1) {
    if (!line.editable) {
      if (delta === 1) return repeat(line);
      return void toast("A sent line comes off with Void.");
    }
    const from = steps.findLast((e) => e.lineId === line.id)?.quantity ?? line.quantity;
    const quantity = Math.max(0, Math.min(MAX_LINE_QUANTITY, from + delta));
    if (quantity === from) return;
    const entry: Stepped = { lineId: line.id, quantity, doneAt: null };
    setStepped((list) => [...list.filter((e) => e.doneAt === null || order.version < e.doneAt), entry]);
    if (quantity === 0) setSelectedId(null);
    void run(async (version) => {
      const result = await setOrderLineQuantity({ orderId, version, lineId: line.id, quantity });
      if (result.ok) setStepped((list) => list.map((e) => (e === entry ? { ...e, doneAt: result.version } : e)));
      return result;
    }).then((accepted) => {
      if (!accepted) setStepped((list) => list.filter((e) => e !== entry));
    });
  }

  // Repeat: the same dish again, same options, note, seat and course.
  function repeat(line: TicketLine) {
    if (line.cancelled) return void toast(`${line.name} is void.`);
    add({ id: line.productId, name: line.name, price: "…" }, line.modifierIds, { note: line.note, seat: line.seat, course: line.course });
  }

  // A change to lines shown at once, saved in the background.
  function patchLines(lineIds: string[], patch: Patch["patch"], change: (version: number) => Promise<OrderChangeResult>) {
    const entry: Patch = { lineIds, patch, doneAt: null };
    setPatches((list) => [...list.filter((e) => e.doneAt === null || order.version < e.doneAt), entry]);
    return run(async (version) => {
      const result = await change(version);
      if (result.ok) setPatches((list) => list.map((e) => (e === entry ? { ...e, doneAt: result.version } : e)));
      return result;
    }).then((accepted) => {
      if (!accepted) setPatches((list) => list.filter((e) => e !== entry));
      return accepted;
    });
  }

  // Seat & course: the picked line, or the next dishes.
  function place(change: { seat?: number | null; course?: Course | null }) {
    if (!selected) return setNextPlace((now) => ({ ...now, ...change }));
    void patchLines([selected.id], change, (version) => placeOrderLines({ orderId, version, lineIds: [selected.id], ...change }));
  }

  // Hold: the picked line's course (lines not sent yet; with no course, just
  // the line) — Send leaves them; Fire sends them later.
  function hold() {
    if (!selected) return void toast("Tap a line on the check — Hold holds its course.");
    if (!selected.editable) return void toast("Only lines that haven't been sent can be held.");
    const lineIds = selected.course ? shownLines.filter((l) => l.editable && l.course === selected.course).map((l) => l.id) : [selected.id];
    const held = !selected.held;
    const what = selected.course ? COURSE_LABEL[selected.course] : selected.name;
    void patchLines(lineIds, { held }, (version) => holdOrderLines({ orderId, version, lineIds, held })).then((accepted) => {
      if (accepted) toast.success(`${what} ${held ? "held" : "released"}.`);
    });
  }

  // Send (all, or a course) and Fire. After a Send — not a Fire — the
  // floor plan comes back for the next table, if that's the setting.
  function sendLines(lineIds: string[] | null, label?: string, then?: "floor") {
    setPanel(null);
    void run(async (version) => {
      const result = await sendOrderToKitchen({ orderId, version, ...(lineIds ? { lineIds } : {}) });
      const message = result.ok ? sentMessage(result.sent) : null;
      if (message) toast.success(label ? `${label}: ${message}` : message);
      return result;
    }).then((accepted) => {
      if (accepted && then === "floor" && sendToFloor) router.push(routes.tables());
    });
  }

  const sendLinesNow = shownLines.map((l) => ({ id: l.id, course: l.course, held: l.held, waiting: l.editable }));
  const sendable = sendChoices(sendLinesNow);
  const heldNow = heldGroups(sendLinesNow);
  const heldCount = heldNow.reduce((n, g) => n + g.lineIds.length, 0);
  // Lines Send would take: those waiting, and dishes tapped but still saving.
  const toSend = sendable.all.length + pending.length;

  // Send: straight away — or, with courses on the check, all or one course.
  // Tapped right after the last dish (still saving), it waits its turn in
  // the change queue and sends them too.
  function send() {
    if (toSend === 0) return void toast(heldCount ? "Only held lines are waiting — fire them from the check." : "Nothing new to send.");
    if (sendsInOneGo(sendLinesNow, pending.map((t) => t.course))) return sendLines(null, undefined, "floor");
    if (pending.length) return void toast("Still saving — one moment.");
    setPanel({ kind: "send" });
  }

  // A dish by its code (the keypad's Add code, or a scan).
  function byCode(code: string) {
    const item = findByCode(data.menu.items, code);
    if (!item) return void toast.error(`No dish with code ${code}.`);
    if (item.unavailable) return void toast.error(`${item.name} is 86 — not available.`);
    setPanel(null);
    pick(item);
  }

  const anyPopup = !!popup || !!settled;
  // A payment in progress (the bill, splitting it, paying, a refund, the
  // settled receipt): auto-lock waits (Part 6f Step 6).
  const paying = popup?.kind === "bill" || popup?.kind === "split" || popup?.kind === "pay" || popup?.kind === "refund" || !!settled;
  const { holdAutoLock } = session;
  useEffect(() => {
    holdAutoLock("pay", paying);
    return () => holdAutoLock("pay", false);
  }, [paying, holdAutoLock]);
  useScan((code) => byCode(code), { enabled: !anyPopup && order.editable });

  // Desk keys: F1 Tables, F2 Send, F5 Pay; a digit opens the Qty / code pad.
  // Not while a pop-up or panel is open (they have their own keys).
  const keys = useRef({ send, pay, tables: () => session.goTables(orderId), qty: (digit: string) => setPanel({ kind: "qty", initial: digit }) });
  useEffect(() => {
    keys.current = { send, pay, tables: () => session.goTables(orderId), qty: (digit: string) => setPanel({ kind: "qty", initial: digit }) };
  });
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "F1" || event.key === "F2" || event.key === "F5") event.preventDefault();
      if (document.querySelector('[role="dialog"]') || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "F1") keys.current.tables();
      else if (event.key === "F2" && order.editable) keys.current.send();
      else if (event.key === "F5" && order.editable && canSettle) keys.current.pay();
      else if (/^\d$/.test(event.key) && order.editable) keys.current.qty(event.key);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [order.editable, canSettle]);

  // Pay from the tables screen (?pay=1): once, then the address loses it.
  const payOnOpen = useRef(openPay);
  useEffect(() => {
    if (!payOnOpen.current) return;
    payOnOpen.current = false;
    router.replace(routes.order(orderId), { scroll: false });
    if (canSettle && order.editable) keys.current.pay();
  }, [router, routes, orderId, canSettle, order.editable]);

  const open = order.editable;
  const ready = lines.filter((line) => line.canServe);
  // Nothing on it and nothing on its way: leaving throws it away (PosSession).
  const empty = open && order.type !== "BAR_TAB" && lines.length === 0 && pending.length === 0 && !saving;
  const { markEmpty } = session;
  useEffect(() => {
    markEmpty(orderId, empty);
    return () => markEmpty(orderId, false);
  }, [markEmpty, orderId, empty]);
  const left: FnKey[] = [
    { label: "Tables", onClick: () => session.goTables(orderId) },
    { label: "Seat", onClick: () => setPanel({ kind: "seat" }), hidden: !open },
    // A quantity waiting for its dish: a tap drops it.
    { label: "Qty", onClick: () => (nextQuantity ? setNextQuantity(null) : setPanel({ kind: "qty", initial: "" })), hidden: !open },
    { label: "Note", onClick: note, hidden: !open },
    { label: "Hold", onClick: hold, hidden: !open },
    { label: "Void", tone: "void", onClick: voidLine, hidden: !open },
    {
      label: "More…",
      onClick: () => setMore((shown) => !shown),
      popover: more ? (
        <MoreMenu
          onClose={closeMore}
          items={[
            { label: "Bill · discount · service", onClick: () => setPopup({ kind: "bill" }), hidden: !open },
            { label: `Mark ready served (${ready.length})`, onClick: () => actions.serveReady(ready), hidden: ready.length === 0 },
            // The order's details form lives on its Table order page (in either view).
            { label: "Guests, waiter, type…", onClick: () => router.push(routesFor("CLASSIC").order(orderId)) },
            { label: "Refund", onClick: () => setPopup({ kind: "refund" }), hidden: !(refundView && canSettle) },
            { label: "Open drawer", onClick: () => session.openDrawer?.(), hidden: !session.openDrawer },
            { label: "View sale", onClick: () => router.push(`/sales/${order.saleId}`), hidden: !order.saleId || !can.sales },
            { label: "Kitchen display", onClick: () => router.push("/restaurant/kitchen"), hidden: !can.kitchen },
            { label: "Cash up", onClick: () => router.push("/pos/cash-up"), hidden: !canSettle },
            { label: "Back office", onClick: session.exit, hidden: !session.leaveHref },
            {
              label: "Cancel order",
              danger: true,
              hidden: !open,
              onClick: () => (order.cancelBlocker ? void toast.error(order.cancelBlocker) : setPopup({ kind: "cancelOrder" })),
            },
          ]}
        />
      ) : null,
    },
  ];
  const printKey: FnKey = order.saleId
    ? {
        label: "Receipt",
        render: (style, content) => (
          <PrintButton printer={printers.receipt} href={`/restaurant/receipt/${order.saleId}`} onQueue={() => printReceiptAction(order.saleId!)} ariaLabel="Print receipt" style={style}>
            {content}
          </PrintButton>
        ),
      }
    : {
        label: "Print bill",
        hidden: !open,
        render: (style, content) => (
          <PrintButton printer={printers.prebill} href={`/restaurant/bill/${orderId}?autoprint=1`} onQueue={() => printBillAction(orderId)} disabled={lines.length === 0} ariaLabel="Print bill" style={style}>
            {content}
          </PrintButton>
        ),
      };
  const right: FnKey[] = [
    printKey,
    { label: "Split", onClick: split, hidden: !open || !canSettle },
    { label: "Send", text: toSend ? `SEND (${toSend})` : "SEND", tone: toSend ? "send" : "sendIdle", onClick: send, hidden: !open },
    { label: "Pay", text: "PAY", sub: totals.total, tone: "pay", onClick: pay, hidden: !open || !canSettle },
  ];
  // What the next dish gets, on the crumb bar.
  const chip = (text: string, data: string) => (
    <span data-next={data} style={{ height: 32, display: "flex", alignItems: "center", padding: "0 12px", borderRadius: 3, background: TOUCH.amber, color: TOUCH.amberInk, fontSize: 14, fontWeight: 700, whiteSpace: "nowrap", flexShrink: 0 }}>
      {text}
    </span>
  );
  const nextPlaceText = placeLabel(nextPlace.seat, nextPlace.course);
  const chips =
    nextQuantity || nextPlaceText ? (
      <>
        {nextPlaceText && chip(`Next: ${nextPlaceText}`, "place")}
        {nextQuantity && chip(`Next item × ${nextQuantity}`, "quantity")}
      </>
    ) : null;
  const covers = order.guests > 0 ? `${order.guests} cover${order.guests === 1 ? "" : "s"}` : null;
  const headerDetail = [order.areaName, covers, waiter && waiter !== session.userName ? `Waiter: ${waiter}` : null, order.note].filter(Boolean).join(" · ") || null;

  return (
    <>
      {/* Kitchen progress (Ready lines) shows up without a reload. */}
      <FloorPolling />
      <PosFrame
        header={
          <PosHeader
            saving={saving}
            orderType={order.type}
            orderId={orderId}
            facts={{
              title: order.tableName ? `Table ${order.tableName}` : noTableLabel(order.type, order.tabName),
              detail: headerDetail,
              orderRef: order.ref,
              closed: order.status === "BILLED" ? "Billed" : order.status === "CANCELLED" ? "Cancelled" : null,
              training: order.training,
            }}
          />
        }
        check={
          <CheckPanel
            lines={shownLines}
            pending={pending}
            totals={totals}
            busy={saving}
            highlightKey={highlightKey}
            selectedId={selected?.id ?? null}
            onSelect={(id) => setSelectedId((current) => (current === id ? null : id))}
            opened={order.openedTime}
            banner={
              open ? (
                <>
                  <GuestLinesPanel touch lines={data.guestLines} busy={saving} onConfirm={actions.confirmGuest} onReject={(ids) => void actions.rejectGuest(ids)} />
                  <ReadyToServe lines={lines} busy={saving} onServe={actions.serveReady} />
                  {heldNow.map((g) => (
                    <div key={g.course ?? "none"} data-held-bar={g.course ?? "none"} style={{ margin: "6px 6px 0", padding: "4px 4px 4px 12px", borderRadius: TOUCH.radius, background: TOUCH.tag.HOLD[0], color: TOUCH.tag.HOLD[1], display: "flex", alignItems: "center", gap: 6, fontSize: 14, fontWeight: 700 }}>
                      <span style={{ flex: 1 }}>
                        {g.course ? COURSE_LABEL[g.course] : "Lines"} held ({g.lineIds.length})
                      </span>
                      <TouchButton background={TOUCH.check} color={TOUCH.tag.HOLD[1]} pressedBackground={TOUCH.rule} onClick={() => void patchLines(g.lineIds, { held: false }, (version) => holdOrderLines({ orderId, version, lineIds: g.lineIds, held: false }))} style={{ height: 40, padding: "0 12px", fontSize: 14, fontWeight: 700 }}>
                        Release
                      </TouchButton>
                      <TouchButton data-fire background={TOUCH.tag.HOLD[1]} onClick={() => sendLines(g.lineIds, `${g.course ? COURSE_LABEL[g.course] : "Held lines"} fired`)} style={{ height: 40, padding: "0 16px", fontSize: 15, fontWeight: 700 }}>
                        Fire
                      </TouchButton>
                    </div>
                  ))}
                </>
              ) : (
                <p data-closed-note style={{ margin: 0, padding: "10px 14px", background: TOUCH.strip, color: TOUCH.inkDim, fontSize: 14, fontWeight: 600 }}>
                  {order.status === "CANCELLED" ? `Cancelled${order.cancelReason ? ` — ${order.cancelReason}` : ""}.` : "Settled."} This order can no longer be changed.
                </p>
              )
            }
            empty="Nothing on the check yet. Tap a dish to add it."
            lineActions={
              open && selected && !selected.cancelled ? (
                <LineStrip
                  name={selected.name}
                  quantity={selected.quantity}
                  seat={selected.seat}
                  canStepDown={selected.editable}
                  onStep={(by) => step(selected, by)}
                  onRepeat={() => repeat(selected)}
                  onSeat={() => setPanel({ kind: "seat" })}
                />
              ) : null
            }
          />
        }
        menu={
          <MenuPad
            menu={data.menu}
            locked={!open}
            returnHome={returnHome}
            onPick={pick}
            onLongPick={longPick}
            onLeaveOverlay={closePanel}
            onOverlayBack={() => (panelBack.current ? panelBack.current() : closePanel())}
            overlayCrumb={panel?.kind === "add" || panel?.kind === "options" ? "Options" : undefined}
            overlayFull={panel?.kind === "search"}
            chips={chips}
            onSearch={open ? () => setPanel({ kind: "search" }) : undefined}
            overlay={
              panel?.kind === "confirmVoid" ? (
                <PanelFrame
                  label="Void a line"
                  title={
                    <>
                      Void {panel.line.quantity > 1 ? `${panel.line.quantity}× ` : ""}
                      {panel.line.name}?
                    </>
                  }
                  hint="Not sent yet"
                  onCancel={closePanel}
                  footer={
                    <TouchButton data-confirm-void background={TOUCH.void} pressedBackground={TOUCH.voidDown} onClick={() => removeLine(panel.line)} style={doneKey}>
                      Void it
                    </TouchButton>
                  }
                >
                  <p style={{ margin: "4px 0", fontSize: 16, color: TOUCH.textDim }}>It hasn&apos;t gone to the kitchen, so it just comes off the check.</p>
                </PanelFrame>
              ) : panel?.kind === "qty" ? (
                <QtyPanel
                  initial={panel.initial}
                  onQuantity={(n) => {
                    setNextQuantity(n > 1 ? n : null);
                    setPanel(null);
                  }}
                  onCode={byCode}
                  onCancel={closePanel}
                />
              ) : panel?.kind === "seat" ? (
                <SeatPanel
                  target={selected ? selected.name : null}
                  seats={Math.max(order.guests, 1)}
                  seat={selected ? selected.seat : nextPlace.seat}
                  course={selected ? selected.course : nextPlace.course}
                  courseLocked={!!selected && !selected.editable}
                  onSeat={(seat) => place({ seat })}
                  onCourse={(course) => place({ course })}
                  onDone={closePanel}
                />
              ) : panel?.kind === "send" ? (
                <SendPanel all={sendable.all} courses={sendable.courses} held={heldCount} onSend={(ids) => sendLines(ids, ids ? `${COURSE_LABEL[sendable.courses.find((c) => c.lineIds === ids)?.course ?? "MAIN"]} sent` : undefined, "floor")} onCancel={closePanel} />
              ) : panel?.kind === "search" ? (
                <SearchPanel
                  items={data.menu.items}
                  colourOf={colourOf}
                  onPick={(item) => {
                    setPanel(null);
                    pick(item);
                  }}
                  onCancel={closePanel}
                />
              ) : panel?.kind === "add" ? (
                <OptionsPanel
                  key={`add-${panel.item.id}`}
                  title={panel.item.name}
                  price={panel.item.price}
                  groups={groupsOf(panel.item.id)}
                  color={colourOf(panel.item.id)}
                  initial={[]}
                  finishLabel="Done"
                  backRef={panelBack}
                  onFinish={(ids) => {
                    setPanel(null);
                    add(panel.item, ids);
                  }}
                  onCancel={closePanel}
                />
              ) : panel?.kind === "options" ? (
                <OptionsPanel
                  key={`edit-${panel.line.id}`}
                  title={panel.line.name}
                  price={panel.line.amount}
                  groups={groupsOf(panel.line.productId)}
                  color={colourOf(panel.line.productId)}
                  initial={panel.line.modifierIds}
                  finishLabel="Save"
                  backRef={panelBack}
                  onFinish={(ids) => {
                    setPanel(null);
                    editLine(panel.line, ids, panel.line.note ?? "");
                  }}
                  onCancel={closePanel}
                />
              ) : panel?.kind === "note" ? (
                <NotePanel
                  key={`note-${panel.line.id}`}
                  lineName={panel.line.name}
                  initial={panel.line.note ?? ""}
                  quickNotes={quickNotes}
                  backRef={panelBack}
                  onSave={(text) => {
                    setPanel(null);
                    if (text !== (panel.line.note ?? "")) editLine(panel.line, panel.line.modifierIds, text);
                  }}
                  onOptions={groupsOf(panel.line.productId).length ? () => setPanel({ kind: "options", line: panel.line }) : undefined}
                  onCancel={closePanel}
                />
              ) : null
            }
          />
        }
        functions={<FunctionBar left={left} right={right} />}
      />

      {(popup?.kind === "cancelLine" || popup?.kind === "cancelOrder") && (
        <CancelModal
          title={popup.kind === "cancelLine" ? `Void ${popup.line.name}?` : `Cancel ${order.ref}?`}
          message={
            popup.kind === "cancelLine"
              ? "It stays on the check, crossed out and left out of the total. Why is it being voided?"
              : "The order closes and its table is free again. Why is it being cancelled?"
          }
          confirmLabel={popup.kind === "cancelLine" ? "Void line" : "Cancel order"}
          reasons={cancelReasonsFor(popup.kind === "cancelLine" ? { served: popup.line.kitchenStatus === "SERVED" } : "order")}
          askWasted={!!waste}
          approvers={waste?.approvers ?? []}
          onSubmit={submitCancel}
          onClose={closePopup}
        />
      )}
      {popup?.kind === "bill" && (
        <BillPanel
          bill={bill}
          approvers={approvers}
          busy={saving}
          onDiscount={discount}
          onServiceCharge={actions.serviceCharge}
          onSplit={actions.split}
          onRemoveSplit={actions.removeSplit}
          canSettle={canSettle}
          onSettle={actions.settle}
          onClose={closePopup}
          prebillPrinter={printers.prebill}
        />
      )}
      {popup?.kind === "split" && <SplitModal bill={bill} onSubmit={actions.split} onClose={closePopup} />}
      {popup?.kind === "pay" && (
        <PaymentModal
          title={order.tableName ? `Table ${order.tableName}` : order.ref}
          due={bill.totals.totalValue}
          waiter={bill.order.hasWaiter ? bill.order.waiter : null}
          onSubmit={actions.settle}
          onClose={closePopup}
        />
      )}
      {popup?.kind === "refund" && refundView && (
        <RefundModal title={order.tableName ? `Table ${order.tableName}` : order.ref} view={refundView} onSubmit={refund} onClose={closePopup} />
      )}
      {settled && (
        <SettledModal
          settled={settled}
          receiptPrinter={printers.receipt}
          onClose={() => {
            if (settled.closed) setPopup(null);
            actions.clearSettled();
          }}
        />
      )}
    </>
  );
}
