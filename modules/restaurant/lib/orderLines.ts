import type { KitchenStatus, OrderStatus, OrderType } from "@prisma/client";
import { z } from "zod";

// The modifier choices snapshotted on an order line (OrderItem.modifiers):
// the option's id (missing on seeded lines), its group, name and price.
export const chosenModifiersSchema = z.array(
  z.object({ id: z.string().optional(), group: z.string(), name: z.string(), price: z.string() }),
);
export type ChosenModifier = z.infer<typeof chosenModifiersSchema>[number];

export function readModifiers(json: unknown): ChosenModifier[] {
  const parsed = chosenModifiersSchema.safeParse(json);
  return parsed.success ? parsed.data : [];
}

// The ticket's grey line under a dish: "Large · Extra plantain · no pepper".
export function lineDetail(modifiers: readonly ChosenModifier[], note: string | null): string {
  return [...modifiers.map((m) => m.name), note ?? ""].filter(Boolean).join(" · ");
}

// A line's state as the waiter sees it (PENDING is "Sent" here, "Pending"
// on the kitchen display).
export const LINE_STATUS_LABEL: Record<KitchenStatus, string> = {
  NEW: "New",
  PENDING: "Sent",
  PREPARING: "Preparing",
  READY: "Ready",
  SERVED: "Served",
};

export const ORDER_TYPE_LABEL: Record<OrderType, string> = {
  DINE_IN: "Dine-in",
  TAKEAWAY: "Takeaway",
  DELIVERY: "Delivery",
};

// The order screen takes changes only while the order is in one of these.
export const EDITABLE_ORDER_STATUSES: readonly OrderStatus[] = ["OPEN", "SENT", "SERVED"];

export const MAX_GUESTS = 30;

// Why an order can't be cancelled yet, or null. Only while nothing sent to
// the kitchen is still live: no line has been sent, or every sent line has
// been cancelled.
export function cancelOrderBlocker(liveSentLines: number): string | null {
  return liveSentLines > 0 ? "Cancel its sent lines first — the kitchen may already be making them." : null;
}
