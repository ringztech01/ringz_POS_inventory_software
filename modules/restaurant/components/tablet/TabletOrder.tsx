"use client";

import { createElement, memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ComponentType } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import type { Department } from "../../lib/posGrid";
import { needsOptions, optionNames, type FlowGroup } from "../../lib/optionFlow";
import { crumb, groupTiles, lineTag, naira, orderCounts, orderMeta, orderTitle, priceOf, sentTo, topGroups, type MenuTile } from "../../lib/tabletOrder";
import { TABLET_ROUTES } from "../../lib/serviceRoutes";
import { editOrderLine, sendOrderToKitchen, setOrderLineQuantity } from "../../server/actions/orders";
import { leaveEmptyOrder } from "../../server/actions/pos";
import type { Approver } from "../../server/queries/approvers";
import type { BillView } from "../../server/queries/bill";
import type { OrderScreenData } from "../../server/queries/orderScreen";
import { useOrderActions } from "../order/useOrderActions";
import type { CheckLine } from "./TabletCheckSheet";
import TabletAutoLock from "./TabletAutoLock";
import { T } from "./tabletTheme";
import { useAddQueue } from "./useAddQueue";
import { TabletPolling, useSafeRefresh, useTabletConnection } from "./useTabletConnection";

// The tablet's Order screen (Part 6g Step 5; design: RingzPOS Tablet.dc.html
// › Tablet POS), upright: the header (‹ TABLES, the table, guests and
// waiter, the total), FOOD / BAR, the department's groups four across (no
// sideways scroll), then the group's sub-groups and dishes as 128 px tiles;
// the white ORDER bar ("5 items", "2 NOT SENT") opens the check; SEND and
// PAY along the bottom. A tap adds a dish at once (saved in the background,
// the desktop POS's own actions); a dish with a required option group opens
// its options first. Everything — prices, totals, what's sold out — is the
// server's. The options, check and payment sheets load just after the screen.

const SHEET_RETRY_MS = 4000;

// A sheet's code, fetched just after the screen is up (not with the page, so
// the page stays small) and tried again until it's here — so a dropped
// connection can't leave a waiter with a dish whose options won't open.
function lazySheet<P extends object>(load: () => Promise<{ default: ComponentType<P> }>) {
  let loaded: ComponentType<P> | null = null;
  let loading = false;
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  };
  const preload = () => {
    if (loaded || loading) return;
    loading = true;
    load()
      .then((module) => {
        loaded = module.default;
        listeners.forEach((listener) => listener());
      })
      .catch(() => undefined)
      .finally(() => {
        loading = false;
      });
  };
  const useReady = () => useSyncExternalStore(subscribe, () => loaded !== null, () => false);
  function Sheet(props: P) {
    const Loaded = useSyncExternalStore(subscribe, () => loaded, () => null);
    return Loaded ? createElement(Loaded, props) : null;
  }
  return { Sheet, preload, useReady };
}
const optionsSheet = lazySheet(() => import("./TabletOptionsSheet"));
const checkSheet = lazySheet(() => import("./TabletCheckSheet"));
const paySheet = lazySheet(() => import("./TabletPaySheet"));
const OptionsSheet = optionsSheet.Sheet;
const CheckSheet = checkSheet.Sheet;
const PaySheet = paySheet.Sheet;

const DEPT = { FOOD: { label: "FOOD", on: T.food, idle: "#FDBA74" }, BAR: { label: "BAR", on: T.bar2, idle: "#93C5FD" } } as const;

type Props = {
  data: OrderScreenData;
  bill: BillView;
  voidApprovers: Approver[];
  quickNotes: string[];
  columns: number;
  sendToFloor: boolean;
  canSettle: boolean;
  canWaste: boolean;
  openPay: boolean;
  // Idle seconds before this tablet locks (0: never).
  autoLockSeconds: number;
};

const OFFLINE = "Offline · that waits for the connection";
let taps = 0;

const Tile = memo(function Tile({ tile, onTap }: { tile: MenuTile; onTap: (tile: MenuTile) => void }) {
  const group = tile.kind === "group";
  const out = tile.kind === "item" && tile.soldOut;
  return (
    <button
      type="button"
      className="tb-press"
      data-menu-tile={tile.name}
      data-kind={tile.kind}
      data-sold-out={out ? "" : undefined}
      onClick={() => onTap(tile)}
      style={{ border: "none", borderRadius: 10, background: group ? T.button : out ? T.buttonAlt : tile.colour, color: out ? "#6B7178" : T.text, boxShadow: group ? `inset 0 0 0 4px ${tile.colour}` : "none", padding: "14px 16px", display: "flex", flexDirection: "column", justifyContent: "space-between", alignItems: "stretch", textAlign: "left", cursor: "pointer", fontFamily: "inherit", minWidth: 0 }}
    >
      <span style={{ fontSize: 21, fontWeight: 800, lineHeight: 1.15, textWrap: "pretty", overflow: "hidden" }}>{tile.name}</span>
      <span style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 6 }}>
        <span style={{ fontSize: 18, fontWeight: 700 }}>{group ? `${tile.count} ${tile.count === 1 ? "item" : "items"}` : out ? "SOLD OUT" : tile.price.replace(/\.00$/, "")}</span>
        <span aria-hidden style={{ fontSize: 24, fontWeight: 900, lineHeight: 1 }}>
          {group ? "›" : !out && tile.required ? "•" : ""}
        </span>
      </span>
    </button>
  );
});

export default function TabletOrder({ data, bill, voidApprovers, quickNotes, columns, sendToFloor, canSettle, canWaste, openPay, autoLockSeconds }: Props) {
  const router = useRouter();
  const { order, menu } = data;
  const orderId = order.id;
  const actions = useOrderActions(data, bill);
  const { run, saving } = actions;
  const { online, check } = useTabletConnection();
  const refresh = useSafeRefresh();
  const tree = menu.tree;
  const departments = (["FOOD", "BAR"] as const).filter((d) => (tree.row[d] ?? []).length > 0);
  const [dept, setDept] = useState<Department>(departments[0] ?? "FOOD");
  const groups = topGroups(tree, dept);
  // Where the grid is: a top group, then any sub-groups opened under it.
  const [path, setPath] = useState<string[]>(() => (groups[0] ? [groups[0].id] : []));
  const groupId = path.at(-1) ?? groups[0]?.id ?? null;
  const tiles = useMemo(() => (groupId ? groupTiles(tree, menu.items, groupId) : []), [tree, menu.items, groupId]);
  const [steps, setSteps] = useState<{ lineId: string; quantity: number; doneAt: number | null }[]>([]);
  const [optionsFor, setOptionsFor] = useState<{ id: string; name: string; price: string } | null>(null);
  const [checkOpen, setCheckOpen] = useState(false);
  // The bill only has what has been sent: new lines go to the kitchen first.
  const [payOpen, setPayOpen] = useState(openPay && canSettle && bill.unsent === 0);
  const leaving = useRef(false);
  const optionsReady = optionsSheet.useReady();
  const checkReady = checkSheet.useReady();
  const payReady = paySheet.useReady();
  const sheetsReady = optionsReady && checkReady && payReady;
  useEffect(() => {
    if (sheetsReady) return;
    const fetchAll = () => [optionsSheet, checkSheet, paySheet].forEach((sheet) => sheet.preload());
    fetchAll();
    const timer = window.setInterval(fetchAll, SHEET_RETRY_MS);
    return () => window.clearInterval(timer);
  }, [sheetsReady]);
  const notReady = () => void toast("One moment — still loading", { id: "tablet-sheet" });

  const groupsOf = useCallback((productId: string): FlowGroup[] => data.modifierGroups[productId] ?? [], [data.modifierGroups]);
  const title = orderTitle(order);
  const queue = useAddQueue({ orderId, title, run, onSaved: () => void refresh() });
  const { forget } = queue;
  useEffect(() => forget(order.version), [forget, order.version]);
  const pending = queue.entries.filter((t) => t.doneAt === null || order.version < t.doneAt);
  const waitingToSync = !online ? pending.filter((t) => t.doneAt === null).length : 0;
  const liveSteps = steps.filter((s) => s.doneAt === null || order.version < s.doneAt);
  const lines = data.lines.map((l) => {
    const step = liveSteps.findLast((s) => s.lineId === l.id);
    return step ? { ...l, quantity: step.quantity } : l;
  }).filter((l) => l.quantity > 0);
  const counts = orderCounts(lines, pending.length);
  const waiter = data.waiters.find((w) => w.id === order.waiterId)?.name ?? null;
  const closedMessage = order.status === "BILLED" ? "This bill is settled — the order can't change." : "This order is closed.";

  useEffect(() => {
    router.prefetch(TABLET_ROUTES.tables({ areaId: order.areaId }));
  }, [router, order.areaId]);

  // A dish on the check at once; saved in the background (the server adds
  // it to the same unsent line when its options are the same).
  function add(item: { id: string; name: string; price: string }, modifierIds: string[]) {
    const key = `tap-${++taps}`;
    // Until it's saved the line shows the dish with its options (a guide: the server prices it).
    const price = naira(priceOf(item.price) + groupsOf(item.id).flatMap((g) => g.options).filter((o) => modifierIds.includes(o.id)).reduce((sum, o) => sum + priceOf(o.price), 0));
    queue.enqueue({ key, productId: item.id, name: item.name, price, options: optionNames(groupsOf(item.id), modifierIds), modifierIds });
    toast(`+1 ${item.name}`, { id: "tablet-add" });
  }

  // A change that needs the server now. A connection lost on the way is
  // said once; the screen stays where it is.
  const needsServer = () => {
    if (online) return true;
    toast(OFFLINE, { id: "tablet-offline" });
    return false;
  };
  const guarded = async <R extends { ok: boolean }>(call: () => Promise<R>): Promise<R | { ok: false; error: string }> => {
    try {
      return await call();
    } catch {
      void check();
      return { ok: false, error: OFFLINE };
    }
  };

  function onTap(tile: MenuTile) {
    if (tile.kind === "group") return setPath((p) => [...p, tile.id]);
    if (tile.soldOut) return void toast(`${tile.name} is sold out`, { id: "tablet-out" });
    if (!order.editable) return void toast.error(closedMessage);
    if (needsOptions(groupsOf(tile.id))) return optionsReady ? setOptionsFor({ id: tile.id, name: tile.name, price: tile.price }) : notReady();
    add({ id: tile.id, name: tile.name, price: tile.price }, []);
  }

  function step(line: CheckLine, by: number) {
    if (!line.id || !needsServer()) return;
    const current = lines.find((l) => l.id === line.id);
    if (!current) return;
    const quantity = current.quantity + by;
    const entry = { lineId: line.id, quantity, doneAt: null as number | null };
    setSteps((list) => [...list.filter((s) => s.doneAt === null || order.version < s.doneAt), entry]);
    void run(async (version) => {
      const result = await guarded(() => setOrderLineQuantity({ orderId, version, lineId: line.id as string, quantity: Math.max(0, quantity) }));
      if (result.ok) setSteps((list) => list.map((s) => (s === entry ? { ...s, doneAt: result.version } : s)));
      return result;
    }).then((accepted) => {
      if (!accepted) setSteps((list) => list.filter((s) => s !== entry));
      void refresh();
    });
  }
  function note(line: CheckLine, text: string) {
    const current = data.lines.find((l) => l.id === line.id);
    if (!current || !needsServer()) return;
    void run((version) => guarded(() => editOrderLine({ orderId, version, lineId: current.id, modifierIds: current.modifierIds, note: text }))).then(() => void refresh());
  }
  function remove(line: CheckLine) {
    const current = lines.find((l) => l.id === line.id);
    if (current) step(line, -current.quantity);
  }

  function send() {
    if (!order.editable) return void toast.error(closedMessage);
    if (!online) return void toast("Offline · SEND waits for the connection", { id: "tablet-offline" });
    // Dishes still saving: SEND goes as soon as they're in (one tap, not two).
    if (pending.length) {
      sendWhenSaved.current = true;
      return void toast("Sending as soon as it's saved", { id: "tablet-sent" });
    }
    if (counts.notSent === 0) return void toast("Nothing new to send");
    void run(async (version) => {
      const result = await guarded(() => sendOrderToKitchen({ orderId, version }));
      if (result.ok && "sent" in result) toast.success(sentTo(result.sent) ?? "Sent", { id: "tablet-sent" });
      return result as Awaited<ReturnType<Parameters<typeof run>[0]>>;
    }).then((accepted) => {
      void refresh();
      if (accepted && sendToFloor) window.setTimeout(() => router.push(TABLET_ROUTES.tables({ areaId: order.areaId })), 900);
    });
  }

  // SEND tapped while dishes were saving: sent once they all are (a dish
  // the server refused is already off the order, with its toast).
  const sendWhenSaved = useRef(false);
  useEffect(() => {
    if (!sendWhenSaved.current || pending.length > 0 || saving) return;
    sendWhenSaved.current = false;
    send();
  });

  function pay() {
    if (!online) return void toast("Offline · PAY waits for the connection", { id: "tablet-offline" });
    if (pending.length || saving) return void toast("Still saving — one moment.");
    if (counts.notSent > 0) return void toast(`SEND the ${counts.notSent} new ${counts.notSent === 1 ? "item" : "items"} first`, { id: "tablet-pay" });
    if (counts.items === 0) return void toast("Nothing to pay yet", { id: "tablet-pay" });
    setPayOpen(true);
  }

  // Sent here to pay (the floor's PAY) with lines not sent yet: says why not.
  const askedToPay = useRef(openPay && canSettle && bill.unsent > 0);
  useEffect(() => {
    if (!askedToPay.current) return;
    askedToPay.current = false;
    toast(`SEND the ${bill.unsent} new ${bill.unsent === 1 ? "item" : "items"} first`, { id: "tablet-pay" });
  }, [bill.unsent]);

  // ‹ TABLES: an order left with nothing on it is let go (the desktop
  // POS's own rule decides), so its table isn't held.
  async function toTables() {
    if (leaving.current) return;
    if (!online) return void toast("Offline · stay on this order until it's back", { id: "tablet-offline" });
    // Nothing tapped is left behind: every dish is on the server first.
    if (pending.length) return void toast("Still saving — one moment.");
    leaving.current = true;
    if (lines.filter((l) => !l.cancelled).length === 0 && pending.length === 0) await leaveEmptyOrder(orderId).catch(() => null);
    router.push(TABLET_ROUTES.tables({ areaId: order.areaId }));
  }

  const checkLines: CheckLine[] = [
    ...lines.map((l) => ({ key: l.id, id: l.id, name: l.name, quantity: l.quantity, options: l.options, note: l.note, tag: lineTag(l), amount: l.amount, served: l.kitchenStatus === "SERVED" })),
    ...pending.map((t) => ({ key: t.key, id: null, name: t.name, quantity: 1, options: t.options, note: null, tag: "NEW" as const, amount: t.price, served: false, waiting: !online && t.doneAt === null })),
  ];

  const inSub = path.length > 1;
  return (
    <div data-tablet-order={orderId} data-sheets-ready={sheetsReady ? "" : undefined} style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column" }}>
      <TabletPolling intervalMs={5000} />
      <TabletAutoLock seconds={autoLockSeconds} hold={payOpen || pending.length > 0 || saving} before={() => (lines.some((l) => !l.cancelled) ? Promise.resolve() : leaveEmptyOrder(orderId))} />
      <header style={{ height: 96, flex: "none", display: "flex", alignItems: "center", gap: 14, padding: "0 16px", background: T.bar }}>
        <button type="button" className="tb-press" data-to-tables onClick={() => void toTables()} style={{ height: 64, padding: "0 20px", border: "none", borderRadius: 8, background: "#1F2226", color: T.text, fontSize: 20, fontWeight: 900, fontFamily: "inherit", cursor: "pointer" }}>
          ‹ TABLES
        </button>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          <span data-order-title style={{ fontSize: 32, fontWeight: 900, lineHeight: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {title}
          </span>
          <span data-order-meta style={{ fontSize: 16, fontWeight: 700, color: T.quiet }}>
            {orderMeta(order.guests, waiter)}
          </span>
        </div>
        <span data-order-total style={{ fontSize: 34, fontWeight: 900, letterSpacing: "-.01em" }}>
          {data.totals.total}
        </span>
      </header>

      {!order.editable && (
        <div role="status" data-order-closed style={{ padding: "12px 16px", background: "#5A1A1A", color: T.lockFg, fontSize: 18, fontWeight: 800 }}>
          {closedMessage}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8, padding: "12px 16px 0" }}>
        {(["FOOD", "BAR"] as const).map((d) => {
          const on = d === dept;
          return (
            <button
              key={d}
              type="button"
              className="tb-press"
              data-dept={d}
              aria-pressed={on}
              disabled={!departments.includes(d)}
              onClick={() => {
                setDept(d);
                const first = topGroups(tree, d)[0];
                setPath(first ? [first.id] : []);
              }}
              style={{ height: 76, border: "none", borderRadius: 8, background: on ? DEPT[d].on : T.button, color: on ? T.text : DEPT[d].idle, fontSize: 28, fontWeight: 900, letterSpacing: ".04em", fontFamily: "inherit", cursor: "pointer", opacity: departments.includes(d) ? 1 : 0.4 }}
            >
              {DEPT[d].label}
            </button>
          );
        })}
      </div>

      <div data-menu-groups style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gridAutoRows: 68, gap: 8, padding: "10px 16px 0" }}>
        {groups.map((g) => {
          const on = g.id === path[0];
          return (
            <button key={g.id} type="button" className="tb-press" data-menu-group={g.name} aria-pressed={on} onClick={() => setPath([g.id])} style={{ border: "none", borderRadius: 8, background: on ? g.colour : T.button, color: T.text, boxShadow: on ? "none" : `inset 0 -6px 0 ${g.colour}`, fontSize: 18, fontWeight: 800, lineHeight: 1.1, padding: "0 6px", fontFamily: "inherit", cursor: "pointer", minWidth: 0, overflow: "hidden" }}>
              {g.name}
            </button>
          );
        })}
      </div>

      {inSub && groupId && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px 0" }}>
          <button type="button" className="tb-press" data-menu-back onClick={() => setPath((p) => p.slice(0, -1))} style={{ height: 56, padding: "0 22px", border: "none", borderRadius: 8, background: T.text, color: "#000", fontSize: 19, fontWeight: 900, fontFamily: "inherit", cursor: "pointer" }}>
            ‹ BACK
          </button>
          <span data-menu-crumb style={{ fontSize: 22, fontWeight: 800, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {crumb(tree, groupId)}
          </span>
        </div>
      )}

      <div data-menu-grid style={{ flex: 1, minHeight: 0, overflowY: "auto", WebkitOverflowScrolling: "touch", padding: "10px 16px 12px", display: "grid", gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gridAutoRows: 128, gap: 10, alignContent: "start" }}>
        {tiles.map((tile) => (
          <Tile key={`${tile.kind}:${tile.id}`} tile={tile} onTap={onTap} />
        ))}
        {tiles.length === 0 && <span style={{ gridColumn: "1 / -1", padding: 32, textAlign: "center", fontSize: 20, fontWeight: 700, color: T.quiet }}>Nothing in this group yet.</span>}
      </div>

      <button type="button" className="tb-press" data-order-bar onClick={() => (checkReady ? setCheckOpen(true) : notReady())} style={{ height: 84, flex: "none", margin: "0 16px", border: "none", borderRadius: "10px 10px 0 0", background: T.text, color: "#000", display: "flex", alignItems: "center", gap: 14, padding: "0 22px", cursor: "pointer", fontFamily: "inherit" }}>
        <span style={{ fontSize: 22, fontWeight: 900 }}>ORDER</span>
        <span data-order-summary style={{ fontSize: 19, fontWeight: 700, color: "#3C403B", flex: 1, textAlign: "left" }}>
          {counts.items ? `${counts.items} ${counts.items === 1 ? "item" : "items"}` : "No items yet"}
          {waitingToSync > 0 && <span data-waiting-sync={waitingToSync}> · {waitingToSync} waiting to sync</span>}
        </span>
        {counts.notSent > 0 && (
          <span data-not-sent={counts.notSent} style={{ height: 40, display: "flex", alignItems: "center", padding: "0 14px", borderRadius: 20, background: "#FFE08A", fontSize: 17, fontWeight: 900 }}>
            {counts.notSent} NOT SENT
          </span>
        )}
        <span aria-hidden style={{ fontSize: 26, fontWeight: 900 }}>
          ▴
        </span>
      </button>
      <div style={{ height: 112, flex: "none", display: "grid", gridTemplateColumns: canSettle ? "minmax(0, 1fr) minmax(0, 1fr)" : "1fr", gap: 10, padding: "12px 16px 16px", background: T.bar }}>
        <button type="button" className="tb-press" data-order-send aria-disabled={!online} onClick={send} style={{ border: "none", borderRadius: 8, background: counts.notSent && online ? T.food : T.edge, color: T.text, opacity: online ? 1 : 0.5, fontSize: 30, fontWeight: 900, letterSpacing: ".03em", fontFamily: "inherit", cursor: "pointer" }}>
          {counts.notSent ? `SEND (${counts.notSent})` : "SEND"}
        </button>
        {canSettle && (
          <button
            type="button"
            className="tb-press"
            data-order-pay
            aria-disabled={!online}
            onClick={pay}
            style={{ border: "none", borderRadius: 8, background: T.pay, color: T.text, opacity: online ? 1 : 0.5, fontSize: 30, fontWeight: 900, letterSpacing: ".03em", fontFamily: "inherit", cursor: "pointer" }}
          >
            PAY
          </button>
        )}
      </div>

      {optionsFor && (
        <OptionsSheet
          name={optionsFor.name}
          price={optionsFor.price}
          groups={groupsOf(optionsFor.id)}
          onCancel={() => setOptionsFor(null)}
          onAdd={(modifierIds) => {
            const item = optionsFor;
            setOptionsFor(null);
            add(item, modifierIds);
          }}
        />
      )}
      {checkOpen && (
        <CheckSheet
          title={title}
          lines={checkLines}
          totals={data.totals}
          quickNotes={quickNotes}
          approvers={voidApprovers}
          canWaste={canWaste}
          busy={saving}
          onStep={step}
          onNote={note}
          onRemove={remove}
          onVoid={async (line, reason, wasted, managerApproval) => {
            const current = data.lines.find((l) => l.id === line.id);
            if (!current) return { ok: false, error: "That line is no longer on the order — refreshed." };
            if (!online) return { ok: false, error: OFFLINE };
            const outcome = await actions.cancelLine(current, reason, "", { wasted, managerApproval });
            void refresh();
            return outcome;
          }}
          onClose={() => setCheckOpen(false)}
        />
      )}
      {payOpen && (
        <PaySheet
          title={title}
          due={bill.totals.totalValue}
          split={!!bill.split}
          settled={actions.settled}
          onSettle={(request) => (online ? actions.settle(request) : Promise.resolve({ ok: false as const, error: "Offline · PAY waits for the connection" }))}
          onDone={() => router.push(TABLET_ROUTES.tables({ areaId: order.areaId }))}
          onClose={() => setPayOpen(false)}
        />
      )}
    </div>
  );
}
