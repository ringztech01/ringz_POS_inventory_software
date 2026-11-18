import "server-only";
import type { PendingGuestLine } from "../../lib/guestOrdering";
import { pendingGuestLines } from "../services/guestOrders";
import type { KitchenStatus, OrderCourse, OrderStatus, OrderType } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/index-browser";
import { prisma } from "@/lib/db";
import { getBusinessSettings } from "@/lib/business-settings";
import { formatNaira } from "@/lib/format";
import { discountLabel } from "../../lib/bill";
import { orderRef } from "../../lib/format";
import { cancelOrderBlocker, EDITABLE_ORDER_STATUSES, lineDetail, readModifiers, withCheck } from "../../lib/orderLines";
import { countsTowardsTotal, lineAmount, orderTotals } from "../../lib/orderTotals";
import { formatAppTime, formatOpenFor } from "../../lib/time";
import { optionLabel } from "../../lib/optionFlow";
import { departmentOf, type Department } from "../../lib/posGrid";
import { buildPosMenu, type PosMenuTree } from "../../lib/posMenu";
import { dishesInStock, recipeSelect } from "../menuStock";
import { getModifierGroupsFor, type ModifierGroupView } from "./modifiers";
import { canTakeOrdersWhere } from "../services/orders";

export type TicketLine = {
  id: string;
  productId: string;
  name: string;
  // "Large · Extra plantain · no pepper".
  detail: string;
  // The chosen options alone, with any price ("Large +₦800", "Pounded
  // yam"), for the touch POS's indented lines (the note is `note`).
  options: string[];
  // Touch POS: when it went to the kitchen ("19:31") and which station.
  sentAt: string | null;
  station: string | null;
  // Touch POS: seat, course, and held back from Send (New lines only).
  seat: number | null;
  course: OrderCourse | null;
  held: boolean;
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
  // A remake (the kitchen display's Remake): made again at no charge.
  remake: boolean;
};

export type MenuCard = {
  id: string;
  name: string;
  code: string;
  categoryId: string;
  price: string;
  image: string | null;
  hasOptions: boolean;
  // A required group: a tap on the touch POS opens its options panel.
  requiredOptions: boolean;
  // The touch POS's Food / Bar side: its group's (lib/posMenu), or its
  // station's while it isn't in a group.
  department: Department;
  // Dimmed and not tappable: switched off, or not enough stock in the
  // order's warehouse.
  unavailable: "off" | "out" | null;
};

export type OrderScreenData = {
  order: {
    id: string;
    ref: string;
    // A training order (Part 6f Step 7f).
    training: boolean;
    version: number;
    status: OrderStatus;
    type: OrderType;
    tableName: string | null;
    // A bar tab's name.
    tabName: string | null;
    areaId: string | null;
    // The table's dining area ("Main hall").
    areaName: string | null;
    guests: number;
    waiterId: string | null;
    open: string;
    // The time it was opened ("19:24").
    openedTime: string;
    saleId: string | null;
    cancelReason: string | null;
    // The order's note: "Pay at counter" / "Pay at the bar" on a QR point's
    // takeaway or tab (Part 8 Step 8).
    note: string | null;
    editable: boolean;
    // Why Cancel order isn't possible right now, or null when it is.
    cancelBlocker: string | null;
  };
  lines: TicketLine[];
  // discount: null when the order has none; servicePercent "off" when its
  // service charge is switched off.
  totals: { subTotal: string; discount: { label: string; amount: string } | null; servicePercent: string; serviceCharge: string; tax: string; taxLabel: string; total: string };
  // New (unsent) lines not held — the Send to kitchen count.
  newCount: number;
  // tree: the touch POS's buttons (groups, sub-groups, dishes and their cells).
  menu: { categories: { id: string; name: string }[]; items: MenuCard[]; tree: PosMenuTree };
  // productId → its option groups, for the dishes and the lines' dishes.
  modifierGroups: Record<string, ModifierGroupView[]>;
  // Users with Manage Orders (plus the current waiter if they've lost it).
  waiters: { id: string; name: string }[];
  // A guest's lines from the table's menu waiting for a waiter to confirm
  // them (Part 8 Step 7) — not order lines yet, not on the bill.
  guestLines: PendingGuestLine[];
};

const money = (value: Decimal) => formatNaira(value.toFixed(2));

// Menu items not soft-deleted, with what the cards need. "Options" and the
// in-stock rule are the ones the add-line action applies (live option
// groups; dishesInStock). Stock is checked in `warehouseId` (the order's).
export async function getMenu(warehouseId: string): Promise<{ menu: OrderScreenData["menu"]; groups: Record<string, ModifierGroupView[]> }> {
  const items = await prisma.product.findMany({
    where: { productType: "MENU_ITEM", deletedAt: null },
    select: {
      id: true,
      name: true,
      code: true,
      price: true,
      isAvailable: true,
      photoPath: true,
      prepStation: true,
      kitchenStation: { select: { code: true } },
      menuGroupId: true,
      menuGridPosition: true,
      category: { select: { id: true, name: true, deletedAt: true } },
      recipeLines: recipeSelect,
    },
    orderBy: [{ category: { name: "asc" } }, { name: "asc" }],
  });
  const [inStock, groups, menuGroups] = await Promise.all([
    dishesInStock(prisma, items, warehouseId),
    getModifierGroupsFor(items.map((i) => i.id)),
    prisma.menuGroup.findMany({ where: { deletedAt: null }, select: { id: true, name: true, parentId: true, department: true, colour: true, rank: true, gridPosition: true } }),
  ]);
  const tree = buildPosMenu(
    menuGroups,
    items.map((item) => ({
      id: item.id,
      name: item.name,
      categoryId: item.category.id,
      categoryName: item.category.name,
      groupId: item.menuGroupId,
      gridPosition: item.menuGridPosition,
      stationDepartment: departmentOf(item.kitchenStation?.code ?? null, item.prepStation),
    })),
  );

  const categories = new Map<string, string>();
  const cards = items.map((item): MenuCard => {
    if (!item.category.deletedAt) categories.set(item.category.id, item.category.name);
    return {
      id: item.id,
      name: item.name,
      code: item.code,
      categoryId: item.category.id,
      price: money(new Decimal(item.price.toString())),
      image: item.photoPath,
      hasOptions: (groups[item.id]?.length ?? 0) > 0,
      requiredOptions: (groups[item.id] ?? []).some((g) => g.minSelect >= 1),
      department: tree.dishDepartment[item.id],
      unavailable: !item.isAvailable ? "off" : !inStock.has(item.id) ? "out" : null,
    };
  });
  return { menu: { categories: [...categories].map(([id, name]) => ({ id, name })), items: cards, tree }, groups };
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
      training: true,
      number: true,
      version: true,
      status: true,
      type: true,
      tabName: true,
      guests: true,
      waiterId: true,
      warehouseId: true,
      openedAt: true,
      closedAt: true,
      saleId: true,
      cancelReason: true,
      notes: true,
      discountType: true,
      discountValue: true,
      serviceCharge: true,
      checkNumber: true, checkName: true, 
      table: { select: { name: true, areaId: true, area: { select: { name: true } } } },
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
          remakeOfId: true,
          seat: true,
          course: true,
          heldAt: true,
          sentAt: true,
          kitchenStation: { select: { name: true } },
          productId: true,
          product: { select: { name: true } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!order) return null;

  const [settings, { menu, groups }, waiters, guestLines] = await Promise.all([getBusinessSettings(), getMenu(order.warehouseId), getWaiters(order.waiterId), pendingGuestLines(order.id)]);
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
      training: order.training,
      version: order.version,
      status: order.status,
      type: order.type,
      tableName: order.table ? withCheck(order.table.name, order) : null,
      tabName: order.tabName,
      areaId: order.table?.areaId ?? null,
      areaName: order.table?.area.name ?? null,
      guests: order.guests,
      waiterId: order.waiterId,
      open: formatOpenFor(Math.max(0, Math.floor((end.getTime() - order.openedAt.getTime()) / 60_000))),
      openedTime: formatAppTime(order.openedAt),
      saleId: order.saleId,
      cancelReason: order.cancelReason,
      note: order.notes,
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
        options: chosen.map((m) => optionLabel(m.name, new Decimal(m.price).isZero() ? "" : `+${formatNaira(new Decimal(m.price).toFixed(2))}`)),
        sentAt: line.sentAt ? formatAppTime(line.sentAt) : null,
        station: line.kitchenStation?.name ?? null,
        seat: line.seat,
        course: line.course,
        held: line.kitchenStatus === "NEW" && !!line.heldAt,
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
        remake: !!line.remakeOfId,
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
    newCount: order.items.filter((line) => line.kitchenStatus === "NEW" && !line.heldAt && countsTowardsTotal(line)).length,
    menu,
    modifierGroups,
    waiters,
    guestLines: EDITABLE_ORDER_STATUSES.includes(order.status) ? guestLines : [],
  };
}
