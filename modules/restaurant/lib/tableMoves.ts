import type { OrderStatus } from "@prisma/client";
import type { TableStatus } from "./tableStatus";

export type MoveMode = "move" | "merge";

type Pickable = { id: string; warehouseId: string; status: TableStatus; orderId: string | null };

// The tables Move table / Merge can pick, in the order's warehouse: free
// ones (Available, or Reserved — the screen warns) to move to, the other
// occupied ones to merge into — a shared table lists each of its checks,
// so with `fromOrderId` another check at the same table can be merged
// into too (two guests deciding to share a bill). The server checks again.
export function pickableTables<T extends Pickable>(tables: T[], fromTableId: string, warehouseId: string, mode: MoveMode, fromOrderId?: string): T[] {
  return tables.filter(
    (t) =>
      t.warehouseId === warehouseId &&
      (mode === "move"
        ? t.id !== fromTableId && (t.status === "Available" || t.status === "Reserved")
        : t.status === "Occupied" && !!t.orderId && (fromOrderId ? t.orderId !== fromOrderId : t.id !== fromTableId)),
  );
}

// The joined order after a merge: Served only if all its live lines are;
// Sent if any live line has gone to the kitchen; otherwise as it was.
export function mergedOrderStatus(counts: { live: number; sent: number; unserved: number }, current: OrderStatus): OrderStatus {
  if (counts.live > 0 && counts.unserved === 0) return "SERVED";
  return counts.sent > 0 ? "SENT" : current;
}
