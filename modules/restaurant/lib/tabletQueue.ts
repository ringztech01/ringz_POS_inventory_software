// The tablet's add queue (Part 6g Step 6): dishes tapped on the Order screen
// wait here, on the tablet, until the server has them — through a dropped
// connection or a reload. Pure: what an entry is, how it's stored, whether
// an attempt whose answer was lost did land, and what a refusal says.

export type QueueEntry = {
  key: string;
  productId: string;
  name: string;
  price: string;
  options: string[];
  modifierIds: string[];
  // The last try whose answer may have been lost: how many of this dish
  // (with these options) the order had just before it.
  baseline: number | null;
  // Saved, at this order version.
  doneAt: number | null;
};

// A line as the server has it, enough to tell one dish from another.
export type SyncLine = { productId: string; modifierIds: string[]; note: string | null; quantity: number; cancelled: boolean };

const sameIds = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().every((id, i) => id === [...b].sort()[i]);

// How many of this dish, with exactly these options and no note, are on the
// order (sent or not: a line sent meanwhile still counts).
export function matchQuantity(lines: readonly SyncLine[], entry: Pick<QueueEntry, "productId" | "modifierIds">): number {
  return lines.filter((l) => !l.cancelled && l.productId === entry.productId && !(l.note ?? "").trim() && sameIds(l.modifierIds, entry.modifierIds)).reduce((sum, l) => sum + l.quantity, 0);
}

// The connection dropped before the answer came: did that try get through?
// More of the dish than just before it means it did — so it's never added twice.
export const didLand = (entry: Pick<QueueEntry, "productId" | "modifierIds" | "baseline">, lines: readonly SyncLine[]): boolean => entry.baseline !== null && matchQuantity(lines, entry) > entry.baseline;

// The order moved on since this tablet last looked: worth another try. Any
// other refusal (sold out, the order closed) is final.
export const VERSION_CONFLICT = "This order was changed by someone else — refreshed.";
export const MAX_CONFLICT_RETRIES = 3;
export const isVersionConflict = (error: string) => error === VERSION_CONFLICT;

// The one-line toast when a dish is taken back off.
export function rejectionText(name: string, error: string): string {
  const reason = isVersionConflict(error) ? "the order was changed elsewhere. Add it again." : error;
  return reason.includes(name) ? `Not added: ${reason}` : `${name} not added: ${reason}`;
}

// Kept on the tablet, per order.
export const QUEUE_PREFIX = "ringz.tablet.queue.";
export const queueKey = (orderId: string) => `${QUEUE_PREFIX}${orderId}`;
export type StoredQueue = { title: string; entries: QueueEntry[] };

const isStrings = (value: unknown): value is string[] => Array.isArray(value) && value.every((v) => typeof v === "string");

// What was stored, checked: anything malformed is left out.
export function readStoredQueue(raw: unknown): StoredQueue {
  const value = (typeof raw === "object" && raw !== null ? raw : {}) as { title?: unknown; entries?: unknown };
  const entries = (Array.isArray(value.entries) ? value.entries : []).filter((e): e is QueueEntry => {
    const x = e as Partial<QueueEntry> | null;
    return !!x && typeof x.key === "string" && typeof x.productId === "string" && typeof x.name === "string" && typeof x.price === "string" && isStrings(x.options) && isStrings(x.modifierIds) && (x.baseline === null || typeof x.baseline === "number");
  });
  return { title: typeof value.title === "string" ? value.title : "", entries: entries.map((e) => ({ ...e, doneAt: null })) };
}

// "2 dishes on O61 waiting to sync".
export const waitingText = (count: number, title: string) => `${count} ${count === 1 ? "dish" : "dishes"} on ${title} waiting to sync`;
