"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { BellRing, Receipt, ShoppingBag } from "lucide-react";
import { announcement, isForMe, REQUEST_LABEL, toAnnounce, type FloorRequest } from "../../lib/tableRequests";
import { guestOrderAnnouncement, type FloorGuestOrder } from "../../lib/guestOrdering";
import { tapTableRequestAction } from "../../server/actions/tableRequests";

// Guests' Call waiter / Request bill on the floor screens (Part 8 Step 6):
// the desktop Tables screen and the waiter's tablet. A table with a request
// gets a bell — pulsing while nobody's acknowledged it, steady once someone
// has. Tapping it acknowledges (OPEN → ACKNOWLEDGED); tapping it again says
// it's done. A new request also pops a toast for the table's waiter (or for
// everyone, when no one has the table).

const RED = "#DC2626";
const PULSE = `@keyframes ringz-request-bell { 0% { box-shadow: 0 0 0 0 rgba(220,38,38,.65); } 70% { box-shadow: 0 0 0 12px rgba(220,38,38,0); } 100% { box-shadow: 0 0 0 0 rgba(220,38,38,0); } }
@media (prefers-reduced-motion: reduce) { [data-request-bell] { animation: none !important; } }`;

const OFFLINE = "Couldn't reach the server. Check the connection and try again.";

// The bell on one table: its requests (one or both types).
export function RequestBell({ requests, tableName, style, size = 30 }: { requests: FloorRequest[]; tableName: string; style?: CSSProperties; size?: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  if (requests.length === 0) return null;
  const open = requests.filter((r) => r.status === "OPEN");
  // A tap deals with every request at that step: all the new ones, else
  // all the acknowledged ones.
  const acting = open.length ? open : requests;
  const what = requests.map((r) => REQUEST_LABEL[r.type]).join(", ");
  const hint = open.length ? "tap to acknowledge" : "tap when done";

  async function tap() {
    if (busy) return;
    setBusy(true);
    try {
      const results = await Promise.all(acting.map((r) => tapTableRequestAction({ id: r.id, seen: r.status })));
      const failed = results.find((r) => !r.ok);
      if (failed && !failed.ok) toast.error(failed.error);
      else toast.success(open.length ? `Table ${tableName}: acknowledged.` : `Table ${tableName}: done.`, { id: `request-tap-${tableName}` });
    } catch {
      toast.error(OFFLINE);
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  const pulsing = open.length > 0;
  return (
    <button
      type="button"
      data-request-bell={tableName}
      data-request-state={pulsing ? "open" : "acknowledged"}
      aria-label={`Table ${tableName}: ${what} — ${hint}`}
      title={`${requests.map((r) => `${REQUEST_LABEL[r.type]} · ${r.minutes} min`).join("\n")}\n(${hint})`}
      onClick={(event) => {
        event.stopPropagation();
        void tap();
      }}
      disabled={busy}
      style={{
        height: size,
        minWidth: size,
        padding: "0 7px",
        borderRadius: size / 2,
        border: pulsing ? "2px solid #fff" : `2px solid ${RED}`,
        background: pulsing ? RED : "#fff",
        color: pulsing ? "#fff" : RED,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 3,
        cursor: busy ? "progress" : "pointer",
        animation: pulsing ? "ringz-request-bell 1.4s ease-out infinite" : "none",
        touchAction: "manipulation",
        WebkitTapHighlightColor: "transparent",
        opacity: busy ? 0.7 : 1,
        zIndex: 3,
        ...style,
      }}
    >
      <style href="ringz-request-bell" precedence="default">
        {PULSE}
      </style>
      {requests.some((r) => r.type === "CALL_WAITER") && <BellRing size={size * 0.52} strokeWidth={2.4} aria-hidden />}
      {requests.some((r) => r.type === "REQUEST_BILL") && <Receipt size={size * 0.52} strokeWidth={2.4} aria-hidden />}
    </button>
  );
}

const SEEN_KEY = "ringzpos.requests.seen";
const SEEN_MAX = 200;

function readSeen(): Set<string> {
  try {
    const raw = sessionStorage.getItem(SEEN_KEY);
    const ids = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

function writeSeen(seen: Set<string>) {
  try {
    sessionStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-SEEN_MAX)));
  } catch {}
}

// Toasts each new request for this user once per browser tab (remembered
// across the floor's refreshes and visits to an order and back).
export function useRequestToasts(requests: FloorRequest[], userId: string | null, areaId: string | null) {
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    seen.current ??= readSeen();
    const fresh = toAnnounce(requests, userId, seen.current);
    if (fresh.length === 0) return;
    for (const request of fresh) {
      seen.current.add(request.id);
      toast(announcement(request, areaId), {
        id: `table-request-${request.id}`,
        icon: request.type === "CALL_WAITER" ? <BellRing size={18} color={RED} aria-hidden /> : <Receipt size={18} color={RED} aria-hidden />,
        duration: 10_000,
      });
    }
    writeSeen(seen.current);
  }, [requests, userId, areaId]);
}

export function requestsByTable(requests: FloorRequest[]): Map<string, FloorRequest[]> {
  const map = new Map<string, FloorRequest[]>();
  for (const request of requests) map.set(request.tableId, [...(map.get(request.tableId) ?? []), request]);
  return map;
}

// A guest's order from the menu waiting for a waiter (Part 8 Step 7): a
// violet bag on the table, pulsing; a tap opens the order (Confirm / Reject
// are there and on the tablet's side panel).
const VIOLET = "#6B3FA0";
const BAG_PULSE = `@keyframes ringz-guest-order { 0% { box-shadow: 0 0 0 0 rgba(107,63,160,.65); } 70% { box-shadow: 0 0 0 12px rgba(107,63,160,0); } 100% { box-shadow: 0 0 0 0 rgba(107,63,160,0); } }
@media (prefers-reduced-motion: reduce) { [data-guest-order-badge] { animation: none !important; } }`;

export function GuestOrderBadge({ order, onOpen, style, size = 30 }: { order: FloorGuestOrder | undefined; onOpen: (orderId: string) => void; style?: CSSProperties; size?: number }) {
  if (!order) return null;
  return (
    <button
      type="button"
      data-guest-order-badge={order.tableName}
      aria-label={`Table ${order.tableName}: guest order, ${order.lines} ${order.lines === 1 ? "line" : "lines"} to confirm — open the order`}
      title={`Guest order · ${order.lines} to confirm · ${order.minutes} min`}
      onClick={(event) => {
        event.stopPropagation();
        onOpen(order.orderId);
      }}
      style={{
        height: size,
        minWidth: size,
        padding: "0 7px",
        borderRadius: size / 2,
        border: "2px solid #fff",
        background: VIOLET,
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 3,
        fontSize: size * 0.42,
        fontWeight: 800,
        cursor: "pointer",
        animation: "ringz-guest-order 1.4s ease-out infinite",
        touchAction: "manipulation",
        WebkitTapHighlightColor: "transparent",
        zIndex: 3,
        ...style,
      }}
    >
      <style href="ringz-guest-order" precedence="default">
        {BAG_PULSE}
      </style>
      <ShoppingBag size={size * 0.5} strokeWidth={2.4} aria-hidden />
      {order.lines}
    </button>
  );
}

// Toasts each new guest send for this user once per browser tab, as the
// bells' toasts are.
export function useGuestOrderToasts(orders: FloorGuestOrder[], userId: string | null, areaId: string | null) {
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    seen.current ??= readSeen();
    const fresh = orders.filter((o) => !seen.current!.has(`g:${o.sendId}`) && isForMe(o, userId));
    if (fresh.length === 0) return;
    for (const order of fresh) {
      seen.current.add(`g:${order.sendId}`);
      toast(guestOrderAnnouncement(order, areaId), { id: `guest-order-${order.sendId}`, icon: <ShoppingBag size={18} color={VIOLET} aria-hidden />, duration: 12_000 });
    }
    writeSeen(seen.current);
  }, [orders, userId, areaId]);
}

export const guestOrderByTable = (orders: FloorGuestOrder[]) => new Map(orders.flatMap((o) => (o.tableId ? [[o.tableId, o] as const] : [])));
// A QR point's takeaway or tab (Step 8), by its order.
export const guestOrderByOrder = (orders: FloorGuestOrder[]) => new Map(orders.map((o) => [o.orderId, o]));
