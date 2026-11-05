// Why a line or an order was cancelled. Saved as text on the line / order
// (OrderItem.cancelReason, Order.cancelReason), e.g. "Wrong item: brought
// the chicken" — the dashboard's Cancelled lines tile counts these lines.

export const CANCEL_REASONS = {
  CHANGED_MIND: "Customer changed mind",
  WRONG_ITEM: "Wrong item",
  KITCHEN_ISSUE: "Kitchen issue",
  // A served line only (the guest sent it back); the food can be logged as
  // waste with it (Log Waste).
  RETURNED_BY_GUEST: "Returned by guest",
  OTHER: "Other",
} as const;

export type CancelReason = keyof typeof CANCEL_REASONS;

// The reasons offered: a whole order, or a line — Returned by guest only for
// a served one.
export function cancelReasonsFor(target: "order" | { served: boolean }): CancelReason[] {
  const all = Object.keys(CANCEL_REASONS) as CancelReason[];
  return target !== "order" && target.served ? all : all.filter((r) => r !== "RETURNED_BY_GUEST");
}

export const CANCEL_DETAILS_MAX = 140;

// "Wrong item", "Wrong item: brought the chicken", or the free text for Other.
export function cancelReasonText(reason: CancelReason, details: string | null): string {
  if (reason === "OTHER") return details ?? CANCEL_REASONS.OTHER;
  return details ? `${CANCEL_REASONS[reason]}: ${details}` : CANCEL_REASONS[reason];
}
