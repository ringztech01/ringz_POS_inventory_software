import { NOTE_MAX } from "./modifiers";

// Guest ordering (Part 8 Step 7): the rules, kept pure so tests can run
// them without a database. The server (services/guestOrders.ts) applies
// every one of them; the guest's page uses some to say so before it sends.

// A line's quantity and note on the guest's basket.
export const GUEST_LINE_QTY_MAX = 20;
// The most an admin can set the lines-per-order cap to.
export const GUEST_MAX_LINES_LIMIT = 50;
export const GUEST_NOTE_MAX = NOTE_MAX;
// Per table code: one Send to waiter every 30 s, and at most 6 in 15 min.
export const GUEST_SEND_GAP_MS = 30_000;
export const GUEST_SEND_WINDOW_MS = 15 * 60_000;
export const GUEST_SENDS_PER_WINDOW = 6;
// The cookie that tells one guest's phone from another (the abuse log, and
// "your order" on that phone only).
export const GUEST_DEVICE_COOKIE = "ringz_guest";

// What happens to a guest's lines:
//   confirm  pending until a waiter confirms them (requireWaiterConfirm, the default)
//   direct   straight onto the order as New lines, for the waiter to send
//   auto     straight to the kitchen (autoSendGuestOrders)
export type GuestMode = "confirm" | "direct" | "auto";

// What a menu offers when guest ordering is on. `where`: a table, or a QR
// point (Step 8) — a takeaway counter or the bar, where the guest gives a
// name and pays at the counter / the bar.
export type GuestWhere = "table" | "takeaway" | "bar";
export type MenuOrdering = { paused: boolean; mode: GuestMode; maxLines: number; where: GuestWhere };

// A QR point's order (Step 8): its name (an order's tabName holds 40) and
// the note the POS shows with it.
export const GUEST_NAME_MAX = 40;
export const POINT_NOTE = { takeaway: "Pay at counter", bar: "Pay at the bar" } as const;

// The guest's name as an order carries it: trimmed, spaces squeezed, no
// control characters; null when there's nothing left.
export function cleanGuestName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, GUEST_NAME_MAX).trim();
  return name || null;
}

// At a QR point many guests share one code: the 30 s / 6-per-15-min limit is
// per phone there, and the code as a whole takes at most this many sends in
// 15 minutes.
export const GUEST_POINT_SENDS_PER_WINDOW = 30;

export function guestMode(settings: { autoSendGuestOrders: boolean; requireWaiterConfirm: boolean }): GuestMode {
  if (settings.autoSendGuestOrders) return "auto";
  return settings.requireWaiterConfirm ? "confirm" : "direct";
}

export type SendRefusal = "too_soon" | "too_many";

// `sends`: when the earlier sends were made (a table code's, or one phone's
// at a QR point); `perWindow`: how many 15 minutes may hold.
export function refuseSend(sends: readonly Date[], now: Date, perWindow: number = GUEST_SENDS_PER_WINDOW, gapMs: number = GUEST_SEND_GAP_MS): SendRefusal | null {
  const ago = sends.map((at) => now.getTime() - at.getTime());
  if (gapMs > 0 && ago.some((ms) => ms < gapMs)) return "too_soon";
  if (ago.filter((ms) => ms < GUEST_SEND_WINDOW_MS).length >= perWindow) return "too_many";
  return null;
}

export type CapRefusal = { kind: "empty" } | { kind: "lines"; max: number } | { kind: "value" };

// The order's caps: at least one line, at most `maxLines` lines, and — when
// set — its value (the lines at menu prices, before tax and service) at
// most `maxValue`. Numbers as decimal strings; compared in kobo.
export function capProblem(input: { lines: number; value: string; maxLines: number; maxValue: string | null }): CapRefusal | null {
  if (input.lines === 0) return { kind: "empty" };
  if (input.lines > input.maxLines) return { kind: "lines", max: input.maxLines };
  if (input.maxValue !== null && toKobo(input.value) > toKobo(input.maxValue)) return { kind: "value" };
  return null;
}

function toKobo(value: string): number {
  const [whole, fraction = ""] = value.trim().split(".");
  return Number(whole) * 100 + Number((fraction + "00").slice(0, 2)) * (whole.startsWith("-") ? -1 : 1);
}

// Only from the restaurant's own network. `host`: the address the phone
// used (the Host header) — a private address, this machine, a .local name
// or the menu's saved address; `forwardedFor`: the addresses Next and any
// proxy recorded — all private. A request from the internet would need the
// server opened to it; this refuses it even then, unless it lies about
// both, which is why the server should never be opened to the internet.
export function isLanRequest(host: string | null, forwardedFor: string | null, savedHost: string | null = null): boolean {
  if (!host) return false;
  const name = hostName(host);
  const hostOk = name === "localhost" || name.endsWith(".local") || isPrivateAddress(name) || (!!savedHost && name === hostName(savedHost));
  if (!hostOk) return false;
  const chain = (forwardedFor ?? "").split(",").map((part) => part.trim()).filter(Boolean);
  return chain.every(isPrivateAddress);
}

function hostName(host: string): string {
  const value = host.trim().toLowerCase();
  if (value.startsWith("[")) return value.slice(1, value.indexOf("]"));
  const colons = value.split(":").length - 1;
  return colons === 1 ? value.split(":")[0] : value;
}

// 10/8, 172.16/12, 192.168/16, 127/8, 169.254/16; ::1, fc00::/7, fe80::/10
// and IPv4 written as IPv6 (::ffff:192.168.1.5).
export function isPrivateAddress(address: string): boolean {
  const value = address.trim().toLowerCase();
  const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateAddress(mapped[1]);
  const v4 = value.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if ([a, b, Number(v4[3]), Number(v4[4])].some((n) => n > 255)) return false;
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  if (!value.includes(":")) return false;
  if (value === "::1") return true;
  return /^f[cd][0-9a-f]{0,2}:/.test(value) || /^fe[89ab][0-9a-f]?:/.test(value);
}

// Where one of the guest's lines is, as their phone shows it. Never who.
export type GuestStage = "waiting" | "sent" | "preparing" | "ready" | "served" | "rejected" | "cancelled";

export function guestStage(line: {
  status: "PENDING" | "CONFIRMED" | "REJECTED";
  orderOpen: boolean;
  item: { kitchenStatus: "NEW" | "PENDING" | "PREPARING" | "READY" | "SERVED"; cancelled: boolean } | null;
}): GuestStage {
  if (line.status === "REJECTED") return "rejected";
  // Still waiting when the order closed: nobody took it.
  if (line.status === "PENDING") return line.orderOpen ? "waiting" : "rejected";
  if (!line.item || line.item.cancelled) return "cancelled";
  switch (line.item.kitchenStatus) {
    case "NEW":
      return line.orderOpen ? "waiting" : "cancelled";
    case "PENDING":
      return "sent";
    case "PREPARING":
      return "preparing";
    case "READY":
      return "ready";
    case "SERVED":
      return "served";
  }
}

// One line on the guest's "your order", as their phone gets it.
export type GuestOrderLineView = { id: string; name: string; quantity: number; detail: string; amount: string | null; stage: GuestStage };
export type GuestOrderView = { lines: GuestOrderLineView[] };

// A guest's line waiting for a waiter, as the order screens show it.
export type PendingGuestLine = { id: string; name: string; quantity: number; detail: string; amount: string; time: string };

// A table's guest order waiting for a waiter, on the tables screens: a
// badge on the table, and a toast for its waiter (or everyone, when the
// guest opened the table themselves) — once per send.
export type FloorGuestOrder = {
  orderId: string;
  // A table's — or none: a QR point's takeaway or bar tab (Step 8), by its label.
  tableId: string | null;
  tableName: string;
  areaId: string | null;
  areaName: string;
  // "Takeaway · Ada", "Tab · Ada" (QR points); null at a table.
  label: string | null;
  // Lines waiting, and the newest send's id (each send is announced once).
  lines: number;
  sendId: string;
  minutes: number;
  waiterIds: string[];
};

export function guestOrderAnnouncement(order: FloorGuestOrder, areaId: string | null): string {
  const where = order.label ?? (order.areaId === areaId ? `Table ${order.tableName}` : `Table ${order.tableName} (${order.areaName})`);
  return `${where} · Guest order (${order.lines} ${order.lines === 1 ? "line" : "lines"})`;
}

// Still going somewhere (the phone checks more often while any is).
export const isUnderway = (stage: GuestStage) => stage === "waiting" || stage === "sent" || stage === "preparing" || stage === "ready";

// The guest's basket, as the page keeps it (prices are only shown, never
// sent: the server prices every line itself).
export type BasketLine = {
  key: string;
  productId: string;
  modifierIds: string[];
  note: string;
  quantity: number;
};

// A basket line's identity: the same dish, options and note add up.
export const basketKey = (productId: string, modifierIds: readonly string[], note: string) => JSON.stringify([productId, [...modifierIds].sort(), note.trim()]);

// Reads a stored basket, dropping anything that isn't one.
export function readBasket(raw: unknown): BasketLine[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((line): BasketLine[] => {
    if (!line || typeof line !== "object") return [];
    const { productId, modifierIds, note, quantity } = line as Record<string, unknown>;
    if (typeof productId !== "string" || !Array.isArray(modifierIds) || !modifierIds.every((id) => typeof id === "string")) return [];
    const text = typeof note === "string" ? note.slice(0, GUEST_NOTE_MAX) : "";
    const qty = typeof quantity === "number" && Number.isInteger(quantity) ? Math.min(Math.max(quantity, 1), GUEST_LINE_QTY_MAX) : 1;
    return [{ key: basketKey(productId, modifierIds as string[], text), productId, modifierIds: modifierIds as string[], note: text, quantity: qty }];
  });
}

// Adds a line to the basket: onto the same dish/options/note if it's there.
export function addToBasket(basket: readonly BasketLine[], line: Omit<BasketLine, "key">): BasketLine[] {
  const key = basketKey(line.productId, line.modifierIds, line.note);
  const same = basket.find((b) => b.key === key);
  if (same) return basket.map((b) => (b.key === key ? { ...b, quantity: Math.min(b.quantity + line.quantity, GUEST_LINE_QTY_MAX) } : b));
  return [...basket, { ...line, note: line.note.trim(), key }];
}
