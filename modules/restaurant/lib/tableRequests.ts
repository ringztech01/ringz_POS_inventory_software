// Service requests (Part 8 Step 6): a guest's Call waiter or Request bill
// from the table's menu. The rules, kept pure so tests can run them without
// a database:
//   OPEN          the bell pulses on the floor screens until a waiter taps it
//   ACKNOWLEDGED  a waiter tapped it ("on the way"); the bell shows steady
//                 until they tap it again (Done), or for ACK_CLEARS_MIN
//   DONE          finished
// A request that's still OPEN after OPEN_LAPSES_MIN (nobody saw it, or the
// restaurant closed) lapses, so yesterday's bell never greets the morning.
// One active request of each type per table, and at most one new request
// per table per RATE_LIMIT_MS.

export const TABLE_REQUEST_TYPES = ["CALL_WAITER", "REQUEST_BILL"] as const;
export type TableRequestType = (typeof TABLE_REQUEST_TYPES)[number];
export type TableRequestStatus = "OPEN" | "ACKNOWLEDGED" | "DONE";

export const ACK_CLEARS_MIN = 10;
export const OPEN_LAPSES_MIN = 240;
export const RATE_LIMIT_MS = 60_000;

const MINUTE = 60_000;

export const REQUEST_LABEL: Record<TableRequestType, string> = {
  CALL_WAITER: "Call waiter",
  REQUEST_BILL: "Request bill",
};

export type RequestState = { status: TableRequestStatus; createdAt: Date; ackAt: Date | null };

// Still to deal with: OPEN and not lapsed, or ACKNOWLEDGED and not yet
// cleared.
export function isActive(request: RequestState, now: Date): boolean {
  if (request.status === "OPEN") return now.getTime() - request.createdAt.getTime() < OPEN_LAPSES_MIN * MINUTE;
  if (request.status === "ACKNOWLEDGED") return !!request.ackAt && now.getTime() - request.ackAt.getTime() < ACK_CLEARS_MIN * MINUTE;
  return false;
}

// The same rule as a Prisma where (for the floor and the guest's status).
export function activeRequestWhere(now: Date) {
  return {
    OR: [
      { status: "OPEN" as const, createdAt: { gt: new Date(now.getTime() - OPEN_LAPSES_MIN * MINUTE) } },
      { status: "ACKNOWLEDGED" as const, ackAt: { gt: new Date(now.getTime() - ACK_CLEARS_MIN * MINUTE) } },
    ],
  };
}

export type RequestRefusal = "already" | "too_soon";

// Whether a table may make a new request of this type now, given its
// requests (any status) — null when it may.
export function refuseRequest(type: TableRequestType, requests: (RequestState & { type: TableRequestType })[], now: Date): RequestRefusal | null {
  if (requests.some((r) => r.type === type && isActive(r, now))) return "already";
  const latest = Math.max(0, ...requests.map((r) => r.createdAt.getTime()));
  if (now.getTime() - latest < RATE_LIMIT_MS) return "too_soon";
  return null;
}

// What the guest's menu shows for each type: nothing yet, waiting for a
// waiter, or a waiter's seen it. Never who.
export type GuestRequestState = "open" | "acknowledged" | null;
export type GuestRequests = Record<TableRequestType, GuestRequestState>;

export function guestRequests(requests: (RequestState & { type: TableRequestType })[], now: Date): GuestRequests {
  const state = (type: TableRequestType): GuestRequestState => {
    const active = requests.filter((r) => r.type === type && isActive(r, now));
    if (active.some((r) => r.status === "OPEN")) return "open";
    return active.length ? "acknowledged" : null;
  };
  return { CALL_WAITER: state("CALL_WAITER"), REQUEST_BILL: state("REQUEST_BILL") };
}

// A request on the floor screens.
export type FloorRequest = {
  id: string;
  tableId: string;
  tableName: string;
  areaId: string;
  areaName: string;
  type: TableRequestType;
  status: "OPEN" | "ACKNOWLEDGED";
  // Minutes since the guest asked.
  minutes: number;
  // The waiters of the table's open checks; empty when no one has it (the
  // request is everyone's).
  waiterIds: string[];
};

// Whose toast it is: the table's waiter, or everyone on the floor when the
// table has none.
export function isForMe(request: Pick<FloorRequest, "waiterIds">, userId: string | null): boolean {
  return request.waiterIds.length === 0 || (!!userId && request.waiterIds.includes(userId));
}

// The requests a floor screen should announce now: OPEN, for this user, not
// announced on this screen before.
export function toAnnounce(requests: FloorRequest[], userId: string | null, seen: ReadonlySet<string>): FloorRequest[] {
  return requests.filter((r) => r.status === "OPEN" && !seen.has(r.id) && isForMe(r, userId));
}

export function announcement(request: FloorRequest, areaId: string | null): string {
  const where = request.areaId === areaId ? `Table ${request.tableName}` : `Table ${request.tableName} (${request.areaName})`;
  return `${where} · ${REQUEST_LABEL[request.type]}`;
}
