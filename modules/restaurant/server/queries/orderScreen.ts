import "server-only";
import type { KitchenStatus, OrderStatus, OrderType } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/index-browser";
import { prisma } from "@/lib/db";
import { getBusinessSettings } from "@/lib/business-settings";
import { formatNaira } from "@/lib/format";
import { discountLabel } from "../../lib/bill";
import { orderRef } from "../../lib/format";
import { cancelOrderBlocker, EDITABLE_ORDER_STATUSES, lineDetail, readModifiers } from "../../lib/orderLines";
import { countsTowardsTotal, lineAmount, orderTotals } from "../../lib/orderTotals";
import { formatOpenFor } from "../../lib/time";
import { dishesInStock, recipeSelect } from "../menuStock";
import { getModifierGroupsFor, type ModifierGroupView } from "./modifiers";
import { canTakeOrdersWhere } from "../services/orders";

export type TicketLine = {
  id: string;
  productId: string;
  name: string;
  // "Large · Extra plantain · no pepper".
  detail: string;
  quantity: number;
  // Before tax, formatted; the lines add up to the Sub total.
  amount: string;
  kitchenStatus: KitchenStatus;
  cancelled: boolean;
  cancelReason: string | null;
  // New and on an open order: the stepper and pencil work.
  editable: boolean;
  // Ready (from the kitchen): the waiter can mark it served.
  canServe: boolean;
  // Sent or later and not cancelled: it can be cancelled, with a reason.
  canCancel: boolean;
  // For the pencil: the options it has (ids) and its note.
  modifierIds: string[];
  note: string | null;
};

export type MenuCard = {
  id: string;
  name: string;
  code: string;
  categoryId: string;
  price: string;
  image: string | null;
  hasOptions: boolean;
  // Dimmed and not tappable: switched off, or not enough stock in the
  // order's warehouse.
  unavailable: "off" | "out" | null;
};

export type OrderScreenData = {
  order: {
    id: string;
    ref: string;
    version: number;
    status: OrderStatus;
    type: OrderType;
    tableName: string | null;
    areaId: string | null;
    guests: number;
    waiterId: string | null;
    open: string;
    saleId: string | null;
    cancelReason: string | null;
    editable: boolean;
    // Why Cancel order isn't possible right now, or null when it is.
    cancelBlocker: string | null;
  };
  lines: TicketLine[];
  // discount: null when the order has none; servicePercent "off" when its
  // service charge is switched off.
  totals: { subTotal: string; discount: { label: string; amount: string } | null; servicePercent: string; serviceCharge: string; tax: string; taxLabel: string; total: string };
  // New (unsent) lines — the Send to kitchen count.
  newCount: number;
  menu: { categories: { id: string; name: string }[]; items: MenuCard[] };
  // productId → its option groups, for the dishes and the lines' dishes.
  modifierGroups: Record<string, ModifierGroupView[]>;
  // Users with Manage Orders (plus the current waiter if they've lost it).
  waiters: { id: string; name: string }[];
};

const money = (value: Decimal) => formatNaira(value.toFixed(2));

// Menu items not soft-deleted, with what the cards need. "Options" and the
// in-stock rule are the ones the add-line action applies (live option
// groups; dishesInStock).
async function getMenu(warehouseId: string): Promise<{ menu: OrderScreenData["menu"]; groups: Record<string, ModifierGroupView[]> }> {
  const items = await prisma.product.findMany({
    where: { productType: "MENU_ITEM", deletedAt: null },
    select: {
      id: true,
      name: true,
      code: true,
      price: true,
      isAvailable: true,
      menuImage: true,
      category: { select: { id: true, name: true, deletedAt: true } },
      recipeLines: recipeSelect,
    },
    orderBy: [{ category: { name: "asc" } }, { name: "asc" }],
  });
  const [inStock, groups] = await Promise.all([dishesInStock(prisma, items, warehouseId), getModifierGroupsFor(items.map((i) => i.id))]);

  const categories = new Map<string, string>();
  const cards = items.map((item): MenuCard => {
    if (!item.category.deletedAt) categories.set(item.category.id, item.category.name);
    return {
      id: item.id,
      name: item.name,
      code: item.code,
      categoryId: item.category.id,
      price: money(new Decimal(item.price.toString())),
      image: item.menuImage,
      hasOptions: (groups[item.id]?.length ?? 0) > 0,
      unavailable: !item.isAvailable ? "off" : !inStock.has(item.id) ? "out" : null,
    };
  });
  return { menu: { categories: [...categories].map(([id, name]) => ({ id, name })), items: cards }, groups };
}

async function getWaiters(currentWaiterId: string | null) {
  const users = await prisma.user.findMany({
    where: { OR: [canTakeOrdersWhere(), ...(currentWaiterId ? [{ id: currentWaiterId }] : [])] },
    select: { id: true, firstName: true, lastName: true },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
  });
  return users.map((u) => ({ id: u.id, name: u.firstName }));
}

// Everything the order screen shows, worked out here: lines, totals (via
// lib/pricing), the menu and the waiters. Null for a missing or deleted order.
export async function getOrderScreen(id: string): Promise<OrderScreenData | null> {
  const order = await prisma.order.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      number: true,
      version: true,
      status: true,
      type: true,
      guests: true,
      waiterId: true,
      warehouseId: true,
      openedAt: true,
      closedAt: true,
      saleId: true,
      cancelReason: true,
      discountType: true,
      discountValue: true,
      serviceCharge: true,
      table: { select: { name: true, areaId: true } },
      items: {
        where: { deletedAt: null },
        select: {
          id: true,
          quantity: true,
          unitPrice: true,
          taxType: true,
          taxRate: true,
          modifiers: true,
          note: true,
          kitchenStatus: true,
          cancelledAt: true,
          cancelReason: true,
          deletedAt: true,
          productId: true,
          product: { select: { name: true } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!order) return null;

  const [settings, { menu, groups }, waiters] = await Promise.all([getBusinessSettings(), getMenu(order.warehouseId), getWaiters(order.waiterId)]);
  // Lines whose dish has left the menu still need their groups for the pencil.
  const missing = order.items.map((line) => line.productId).filter((id) => !(id in groups));
  const modifierGroups = missing.length ? { ...groups, ...(await getModifierGroupsFor(missing)) } : groups;
  const editable = EDITABLE_ORDER_STATUSES.includes(order.status);
  const totals = orderTotals(order.items, settings.restaurantServiceChargePercent, order);
  const end = order.closedAt ?? new Date();

  return {
    order: {
      id: order.id,
      ref: orderRef(order.number),
      version: order.version,
      status: order.status,
      type: order.type,
      tableName: order.table?.name ?? null,
      areaId: order.table?.areaId ?? null,
      guests: order.guests,
      waiterId: order.waiterId,
      open: formatOpenFor(Math.max(0, Math.floor((end.getTime() - order.openedAt.getTime()) / 60_000))),
      saleId: order.saleId,
      cancelReason: order.cancelReason,
      editable,
      cancelBlocker: cancelOrderBlocker(
        order.items.filter((line) => countsTowardsTotal(line) && line.kitchenStatus !== "NEW").length,
      ),
    },
    lines: order.items.map((line) => {
      const chosen = readModifiers(line.modifiers);
      const options = (modifierGroups[line.productId] ?? []).flatMap((g) => g.options.map((o) => ({ ...o, group: g.name })));
      return {
        id: line.id,
        productId: line.productId,
        name: line.product.name,
        detail: lineDetail(chosen, line.note),
        quantity: line.quantity,
        amount: money(lineAmount(line)),
        kitchenStatus: line.kitchenStatus,
        cancelled: !countsTowardsTotal(line),
        cancelReason: line.cancelReason,
        editable: editable && line.kitchenStatus === "NEW" && countsTowardsTotal(line),
        canServe: editable && line.kitchenStatus === "READY" && countsTowardsTotal(line),
        canCancel: editable && line.kitchenStatus !== "NEW" && countsTowardsTotal(line),
        // Seeded lines have no option ids: matched by group and name.
        modifierIds: chosen.flatMap((m) => m.id ?? options.find((o) => o.group === m.group && o.name === m.name)?.id ?? []),
        note: line.note,
      };
    }),
    totals: {
      subTotal: money(totals.subTotal),
      discount: order.discountType ? { label: discountLabel(order.discountType, order.discountValue.toString()), amount: `−${money(totals.discount)}` } : null,
      servicePercent: order.serviceCharge ? `${new Decimal(settings.restaurantServiceChargePercent.toString()).toString()}%` : "off",
      serviceCharge: money(totals.serviceCharge),
      tax: money(totals.tax),
      taxLabel: totals.taxRates.length === 1 ? `Tax (${totals.taxRates[0]}%)` : "Tax",
      total: money(totals.total),
    },
    newCount: order.items.filter((line) => line.kitchenStatus === "NEW" && countsTowardsTotal(line)).length,
    menu,
    modifierGroups,
    waiters,
  };
}
