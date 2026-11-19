"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { BellRing, Receipt, ShoppingBag, Smartphone } from "lucide-react";
import { announcement, isForMe, REQUEST_LABEL, toAnnounce, type FloorRequest } from "../../lib/tableRequests";
import { guestOrderAnnouncement, type FloorGuestOrder } from "../../lib/guestOrdering";
import { tapTableRequestAction } from "../../server/actions/tableRequests";

// Guests' Call waiter / Request bill on the floor screens (Part 8 Step 6;
// 6g follow-up 2): the desktop Tables screen, the Classic floor and the
// tablet. A table whose guest is waiting gets a pulsing bell; one tap
// acknowledges (OPEN → ACKNOWLEDGED) and the bell goes. The guest's phone
// then says the waiter is on the way, until it clears by itself
// (lib/tableRequests ACK_CLEARS_MIN). A new request also pops a toast for the
// table's waiter (or for everyone, when no one has the table).

const RED = "#DC2626";
const PULSE = `@keyframes ringz-request-bell { 0% { box-shadow: 0 0 0 0 rgba(220,38,38,.65); } 70% { box-shadow: 0 0 0 12px rgba(220,38,38,0); } 100% { box-shadow: 0 0 0 0 rgba(220,38,38,0); } }
@media (prefers-reduced-motion: reduce) { [data-request-bell] { animation: none !important; } }`;

const OFFLINE = "Couldn't reach the server. Check the connection and try again.";

// Only the requests nobody has acknowledged yet show (and ring).
export const openRequests = (requests: readonly FloorRequest[]) => requests.filter((r) => r.status === "OPEN");

// The bell on one table: its open requests (one or both types). `onDone`:
// what to do once tapped (the tablet refreshes only when it's online);
// otherwise the page refreshes.
export function RequestBell({ requests, tableName, style, size = 30, onDone }: { requests: FloorRequest[]; tableName: string; style?: CSSProperties; size?: number; onDone?: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const open = openRequests(requests);
  if (open.length === 0) return null;
  const what = open.map((r) => REQUEST_LABEL[r.type]).join(", ");

  async function tap() {
    if (busy) return;
    setBusy(true);
    try {
      const results = await Promise.all(open.map((r) => tapTableRequestAction({ id: r.id, seen: "OPEN" })));
      const failed = results.find((r) => !r.ok);
      if (failed && !failed.ok) toast.error(failed.error);
      else toast.success(`Table ${tableName}: acknowledged.`, { id: `request-tap-${tableName}` });
    } catch {
      toast.error(OFFLINE);
    } finally {
      setBusy(false);
      if (onDone) onDone();
      else router.refresh();
    }
  }

  return (
    <button
      type="button"
      data-request-bell={tableName}
      data-request-state="open"
      data-request-types={open.map((r) => r.type).join(" ")}
      aria-label={`Table ${tableName}: ${what} — tap to acknowledge`}
      title={`${open.map((r) => `${REQUEST_LABEL[r.type]} · ${r.minutes} min`).join("\n")}\n(tap to acknowledge)`}
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
        border: "2px solid #fff",
        background: RED,
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 3,
        cursor: busy ? "progress" : "pointer",
        animation: "ringz-request-bell 1.4s ease-out infinite",
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
      {open.some((r) => r.type === "CALL_WAITER") && <BellRing size={size * 0.52} strokeWidth={2.4} aria-hidden />}
      {open.some((r) => r.type === "REQUEST_BILL") && <Receipt size={size * 0.52} strokeWidth={2.4} aria-hidden />}
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

// A takeaway order (6g follow-up 2): a bag, on the takeaways-and-tabs strips
// of the desktop Tables screen and the tablet. Bar tabs have none.
export function TakeawayBag({ size = 16, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <span data-takeaway-bag aria-label="Takeaway" role="img" style={{ display: "inline-flex", alignItems: "center", flexShrink: 0 }}>
      <ShoppingBag size={size} strokeWidth={2.4} color={color} aria-hidden />
    </span>
  );
}

// A guest's order from the menu waiting for a waiter (Part 8 Step 7): a
// violet phone on the table, pulsing; a tap opens the order (Confirm / Reject
// are there and on the tablet's side panel). A phone, not a bag: the bag
// means a takeaway (6g follow-up 2).
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
      <Smartphone size={size * 0.5} strokeWidth={2.4} aria-hidden />
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
      toast(guestOrderAnnouncement(order, areaId), { id: `guest-order-${order.sendId}`, icon: <Smartphone size={18} color={VIOLET} aria-hidden />, duration: 12_000 });
    }
    writeSeen(seen.current);
  }, [orders, userId, areaId]);
}

export const guestOrderByTable = (orders: FloorGuestOrder[]) => new Map(orders.flatMap((o) => (o.tableId ? [[o.tableId, o] as const] : [])));
// A QR point's takeaway or tab (Step 8), by its order.
export const guestOrderByOrder = (orders: FloorGuestOrder[]) => new Map(orders.map((o) => [o.orderId, o]));
