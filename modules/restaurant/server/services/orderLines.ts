import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { readModifiers, type ChosenModifier } from "../../lib/orderLines";
import { checkSelection, MAX_LINE_QUANTITY, mergeKey } from "../../lib/modifiers";
import { linePrice } from "../../lib/orderTotals";
import type { AddLineInput, EditLineInput, LineQuantityInput } from "../../schemas/orderLine";
import { dishesInStock, recipeSelect } from "../menuStock";
import { lockOrderAt, markBillChanged, type OrderChangeResult } from "./orders";

// Adding, editing and re-counting order lines. The server owns prices: the
// browser sends a dish, option ids and a note; the price and the options'
// price changes are looked up here and snapshotted on the line, so later
// menu price changes never touch lines already on an order. Only New
// (unsent) lines can be changed this way. Every change locks the order,
// checks the screen's version and bumps it.

const NOT_NEW = "Only lines that haven't been sent to the kitchen can be changed — refreshed.";
const LINE_GONE = "That line is no longer on the order — refreshed.";

const groupSelect = {
  where: { deletedAt: null },
  select: {
    id: true,
    name: true,
    minSelect: true,
    maxSelect: true,
    modifiers: {
      where: { deletedAt: null },
      select: { id: true, name: true, price: true },
      orderBy: [{ sortOrder: "asc" as const }, { name: "asc" as const }],
    },
  },
  orderBy: [{ sortOrder: "asc" as const }, { name: "asc" as const }],
};

type Dish = Prisma.ProductGetPayload<{
  select: {
    id: true;
    name: true;
    price: true;
    isAvailable: true;
    taxType: true;
    orderTax: true;
    prepStation: true;
    recipeLines: typeof recipeSelect;
    modifierGroups: typeof groupSelect;
  };
}>;

async function loadDish(tx: Prisma.TransactionClient, productId: string): Promise<Dish | null> {
  return tx.product.findFirst({
    where: { id: productId, productType: "MENU_ITEM", deletedAt: null },
    select: {
      id: true,
      name: true,
      price: true,
      isAvailable: true,
      taxType: true,
      orderTax: true,
      prepStation: true,
      recipeLines: recipeSelect,
      modifierGroups: groupSelect,
    },
  });
}

// The dish's groups that can be chosen from (deleted ones and empty ones
// aren't offered on the screen either).
const liveGroups = (dish: Dish) => dish.modifierGroups.filter((g) => g.modifiers.length > 0);

// Checks the chosen options against the dish's groups (min / max, options
// that belong to it) and returns them in the dish's group order, priced.
// `keepPrices`: options already on the line keep their snapshot price.
function chooseOptions(dish: Dish, modifierIds: readonly string[], keepPrices: ReadonlyMap<string, string> = new Map()) {
  const groups = liveGroups(dish);
  const problem = checkSelection(
    groups.map((g) => ({ id: g.id, name: g.name, minSelect: g.minSelect, maxSelect: g.maxSelect, optionIds: g.modifiers.map((m) => m.id) })),
    modifierIds,
  );
  if (problem) return { ok: false as const, error: problem };
  const chosen: ChosenModifier[] = groups.flatMap((g) =>
    g.modifiers
      .filter((m) => modifierIds.includes(m.id))
      .map((m) => ({ id: m.id, group: g.name, name: m.name, price: keepPrices.get(m.id) ?? m.price.toFixed(2) })),
  );
  return { ok: true as const, chosen };
}

// Every line change is a waiter edit: it also outdates a printed bill.
async function bump(tx: Prisma.TransactionClient, orderId: string) {
  await markBillChanged(tx, orderId);
  return tx.order.update({ where: { id: orderId }, data: { version: { increment: 1 } }, select: { version: true } });
}

// The line's identity for merging: its options (ids, or group:name on old
// seeded lines) and note.
const keyOf = (modifiers: readonly ChosenModifier[], note: string | null) =>
  mergeKey(modifiers.map((m) => m.id ?? `${m.group}:${m.name}`), note);

// Tap a dish (or Add to order): one New line at today's price, or +1 on a
// New line with the same dish, options, note and snapshot price. Sent lines
// are never merged into.
export async function addLine({ orderId, version, productId, modifierIds, note }: AddLineInput): Promise<OrderChangeResult> {
  return prisma.$transaction(async (tx): Promise<OrderChangeResult> => {
    const locked = await lockOrderAt(tx, orderId, version);
    if (!locked.ok) return locked;
    const { warehouseId } = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { warehouseId: true } });

    const dish = await loadDish(tx, productId);
    if (!dish) return { ok: false, error: "That dish is no longer on the menu.", stale: true };
    if (!dish.isAvailable) return { ok: false, error: `${dish.name} is currently unavailable.`, stale: true };
    if (!(await dishesInStock(tx, [dish], warehouseId)).has(dish.id)) {
      return { ok: false, error: `${dish.name} is out of stock in this order's warehouse.`, stale: true };
    }

    const options = chooseOptions(dish, modifierIds);
    if (!options.ok) return options;
    const unitPrice = linePrice(dish.price.toString(), options.chosen.map((m) => m.price));
    const key = keyOf(options.chosen, note);

    const candidates = await tx.orderItem.findMany({
      where: { orderId, productId, kitchenStatus: "NEW", deletedAt: null, cancelledAt: null },
      select: { id: true, quantity: true, unitPrice: true, modifiers: true, note: true },
      orderBy: { createdAt: "asc" },
    });
    const twin = candidates.find((c) => unitPrice.equals(c.unitPrice.toString()) && keyOf(readModifiers(c.modifiers), c.note) === key);

    if (twin) {
      if (twin.quantity >= MAX_LINE_QUANTITY) return { ok: false, error: `${dish.name} is already at ${MAX_LINE_QUANTITY} on this line.` };
      await tx.orderItem.update({ where: { id: twin.id }, data: { quantity: twin.quantity + 1 } });
    } else {
      await tx.orderItem.create({
        data: {
          orderId,
          productId,
          quantity: 1,
          unitPrice: unitPrice.toFixed(2),
          taxType: dish.taxType,
          taxRate: dish.orderTax ?? 0,
          modifiers: options.chosen.length ? options.chosen : undefined,
          note,
          station: dish.prepStation ?? "KITCHEN",
        },
      });
    }
    return { ok: true, version: (await bump(tx, orderId)).version };
  });
}

// Lock-free reads of a New line on the order (the order row is locked).
async function newLine(tx: Prisma.TransactionClient, orderId: string, lineId: string) {
  const line = await tx.orderItem.findFirst({
    where: { id: lineId, orderId, deletedAt: null },
    select: { id: true, productId: true, kitchenStatus: true, cancelledAt: true, unitPrice: true, modifiers: true },
  });
  if (!line) return { ok: false as const, error: LINE_GONE, stale: true as const };
  if (line.kitchenStatus !== "NEW" || line.cancelledAt) return { ok: false as const, error: NOT_NEW, stale: true as const };
  return { ok: true as const, line };
}

// The pencil: new options and/or note for a New line. Its price keeps the
// line's own snapshot — the dish price it was added at, and the snapshot
// price of any option it already had; only newly picked options are priced
// today.
export async function editLine({ orderId, version, lineId, modifierIds, note }: EditLineInput): Promise<OrderChangeResult> {
  return prisma.$transaction(async (tx): Promise<OrderChangeResult> => {
    const locked = await lockOrderAt(tx, orderId, version);
    if (!locked.ok) return locked;
    const found = await newLine(tx, orderId, lineId);
    if (!found.ok) return found;
    const { line } = found;

    const dish = await loadDish(tx, line.productId);
    if (!dish) return { ok: false, error: "That dish is no longer on the menu, so its options can't be changed." };
    const before = readModifiers(line.modifiers);
    const kept = new Map(before.flatMap((m) => (m.id ? [[m.id, m.price] as const] : [])));
    const options = chooseOptions(dish, modifierIds, kept);
    if (!options.ok) return options;

    // The dish price this line was added at: its unit price less the options it had.
    const dishPrice = new Prisma.Decimal(line.unitPrice).minus(before.reduce((sum, m) => sum.plus(m.price), new Prisma.Decimal(0)));
    const unitPrice = linePrice(dishPrice.toString(), options.chosen.map((m) => m.price));

    await tx.orderItem.update({
      where: { id: lineId },
      data: { unitPrice: unitPrice.toFixed(2), modifiers: options.chosen.length ? options.chosen : Prisma.DbNull, note },
    });
    return { ok: true, version: (await bump(tx, orderId)).version };
  });
}

// The stepper: a New line's quantity, 1–99; 0 removes it (soft delete — it
// was never sent).
export async function setLineQuantity({ orderId, version, lineId, quantity }: LineQuantityInput): Promise<OrderChangeResult> {
  return prisma.$transaction(async (tx): Promise<OrderChangeResult> => {
    const locked = await lockOrderAt(tx, orderId, version);
    if (!locked.ok) return locked;
    const found = await newLine(tx, orderId, lineId);
    if (!found.ok) return found;

    await tx.orderItem.update({
      where: { id: lineId },
      data: quantity === 0 ? { deletedAt: new Date() } : { quantity },
    });
    return { ok: true, version: (await bump(tx, orderId)).version };
  });
}
