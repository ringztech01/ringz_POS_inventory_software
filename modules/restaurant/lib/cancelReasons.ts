// Why a line or an order was cancelled. Saved as text on the line / order
// (OrderItem.cancelReason, Order.cancelReason), e.g. "Wrong item: brought
// the chicken" — the dashboard's Cancelled lines tile counts these lines.

export const CANCEL_REASONS = {
  CHANGED_MIND: "Customer changed mind",
  WRONG_ITEM: "Wrong item",
  KITCHEN_ISSUE: "Kitchen issue",
  OTHER: "Other",
} as const;

export type CancelReason = keyof typeof CANCEL_REASONS;

export const CANCEL_DETAILS_MAX = 140;

// "Wrong item", "Wrong item: brought the chicken", or the free text for Other.
export function cancelReasonText(reason: CancelReason, details: string | null): string {
  if (reason === "OTHER") return details ?? CANCEL_REASONS.OTHER;
  return details ? `${CANCEL_REASONS[reason]}: ${details}` : CANCEL_REASONS[reason];
}
