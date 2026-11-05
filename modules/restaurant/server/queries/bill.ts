import "server-only";
import { Decimal } from "@prisma/client/runtime/index-browser";
import { prisma } from "@/lib/db";
import { getBusinessSettings } from "@/lib/business-settings";
import { formatNaira } from "@/lib/format";
import type { BillPartStatus, BillSplitMode, OrderDiscountType } from "@prisma/client";
import { sumSubtotals } from "@/lib/pricing";
import { discountLabel, isBilled, summariseBill } from "../../lib/bill";
import { billPartLabel, SPLIT_MODE_LABEL } from "../../lib/billSplit";
import { orderRef } from "../../lib/format";
import { priceChangeLabel } from "../../lib/modifiers";
import { lineAmount } from "../../lib/orderTotals";
import { EDITABLE_ORDER_STATUSES, LINE_STATUS_LABEL, ORDER_TYPE_LABEL, readModifiers } from "../../lib/orderLines";

// The bill for an order (Bill panel, pre-bill print): the billed lines with
// their options, the totals and the warnings — all from the lines'
// snapshots, worked out here (lib/bill.ts). Read-only.

export type BillLine = {
  id: string;
  name: string;
  quantity: number;
  // Per unit, options included (the snapshot), and the line before tax.
  unitPrice: string;
  amount: string;
  modifiers: { name: string; price: string }[];
  note: string | null;
  status: string;
  served: boolean;
};

export type BillPartView = {
  id: string;
  number: number;
  label: string;
  amount: string;
  // The amount as a plain number ("17.11"), for the Payment pop-up's figures.
  amountValue: string;
  status: BillPartStatus;
  // By item: what this guest pays for.
  items: { name: string; quantity: number }[];
};

export type BillView = {
  order: {
    id: string;
    ref: string;
    table: string;
    type: string;
    waiter: string;
    guests: number;
    version: number;
    editable: boolean;
    openedAt: string;
    // When the pre-bill was last printed (null: not printed, or changed since).
    billPrintedAt: string | null;
    // Set: it was printed, then the order changed ("Bill changed since print").
    billChangedAt: string | null;
    serviceCharge: boolean;
    // A tip goes to the order's waiter, so it needs one.
    hasWaiter: boolean;
  };
  // The order's discount, if it has one.
  discount: { type: OrderDiscountType; value: string; label: string; reason: string; by: string | null; approvedBy: string | null } | null;
  // Above this a discount needs an approver, e.g. "10%".
  discountLimit: string;
  lines: BillLine[];
  // totalValue: the total as a plain number ("51.35"), for the Split
  // pop-up's preview only — the server works out the parts.
  totals: { subTotal: string; discount: string; servicePercent: string; serviceCharge: string; taxLabel: string; tax: string; total: string; totalValue: string };
  // The bill's split, if it has one. `stale`: its parts no longer add up to
  // the total (a setting changed) — split again before settling.
  split: { mode: BillSplitMode; modeLabel: string; parts: BillPartView[]; stale: boolean } | null;
  unsent: number;
  notServed: number;
  settleBlocker: string | null;
};

const money = (value: Decimal) => formatNaira(value.toFixed(2));

export async function getBill(orderId: string): Promise<BillView | null> {
  const [order, settings] = await Promise.all([
    prisma.order.findFirst({
      where: { id: orderId, deletedAt: null },
      select: {
        id: true,
        number: true,
        type: true,
        status: true,
        guests: true,
        version: true,
        openedAt: true,
        billPrintedAt: true,
        billChangedAt: true,
        serviceCharge: true,
        discountType: true,
        discountValue: true,
        discountReason: true,
        discountBy: { select: { firstName: true } },
        discountApprovedBy: { select: { firstName: true } },
        table: { select: { name: true } },
        waiter: { select: { firstName: true } },
        billParts: {
          where: { deletedAt: null },
          orderBy: { number: "asc" },
          select: {
            id: true,
            number: true,
            mode: true,
            amount: true,
            status: true,
            lines: { select: { quantity: true, orderItem: { select: { createdAt: true, product: { select: { name: true } } } } } },
          },
        },
        items: {
          where: { deletedAt: null },
          orderBy: { createdAt: "asc" },
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
            deletedAt: true,
            product: { select: { name: true } },
          },
        },
      },
    }),
    getBusinessSettings(),
  ]);
  if (!order) return null;

  const summary = summariseBill(order.items, settings.restaurantServiceChargePercent, order);
  const editable = EDITABLE_ORDER_STATUSES.includes(order.status);
  const parts = order.billParts;
  return {
    order: {
      id: order.id,
      ref: orderRef(order.number),
      table: order.table?.name ?? ORDER_TYPE_LABEL[order.type],
      type: ORDER_TYPE_LABEL[order.type],
      waiter: order.waiter?.firstName ?? "No waiter",
      guests: order.guests,
      version: order.version,
      editable,
      openedAt: order.openedAt.toISOString(),
      billPrintedAt: order.billPrintedAt?.toISOString() ?? null,
      billChangedAt: order.billChangedAt?.toISOString() ?? null,
      serviceCharge: order.serviceCharge,
      hasWaiter: !!order.waiter,
    },
    discount: order.discountType
      ? {
          type: order.discountType,
          value: new Decimal(order.discountValue.toString()).toString(),
          label: discountLabel(order.discountType, order.discountValue.toString()),
          reason: order.discountReason ?? "",
          by: order.discountBy?.firstName ?? null,
          approvedBy: order.discountApprovedBy?.firstName ?? null,
        }
      : null,
    discountLimit: `${new Decimal(settings.restaurantDiscountLimitPercent.toString()).toString()}%`,
    lines: order.items.filter(isBilled).map((line) => ({
      id: line.id,
      name: line.product.name,
      quantity: line.quantity,
      unitPrice: money(new Decimal(line.unitPrice.toString())),
      amount: money(lineAmount(line)),
      modifiers: readModifiers(line.modifiers).map((m) => ({ name: m.name, price: Number(m.price) === 0 ? "" : priceChangeLabel(m.price) })),
      note: line.note,
      status: LINE_STATUS_LABEL[line.kitchenStatus],
      served: line.kitchenStatus === "SERVED",
    })),
    totals: {
      subTotal: money(summary.subTotal),
      discount: money(summary.discount),
      servicePercent: order.serviceCharge ? `${new Decimal(settings.restaurantServiceChargePercent.toString()).toString()}%` : "off",
      serviceCharge: money(summary.serviceCharge),
      taxLabel: summary.taxRates.length === 1 ? `Tax (${summary.taxRates[0]}%)` : "Tax",
      tax: money(summary.tax),
      total: money(summary.total),
      totalValue: summary.total.toFixed(2),
    },
    split: parts.length
      ? {
          mode: parts[0].mode,
          modeLabel: SPLIT_MODE_LABEL[parts[0].mode],
          parts: parts.map((part) => ({
            id: part.id,
            number: part.number,
            label: billPartLabel(part.mode, part.number, parts.length),
            amount: money(new Decimal(part.amount.toString())),
            amountValue: part.amount.toFixed(2),
            status: part.status,
            items: [...part.lines]
              .sort((a, b) => a.orderItem.createdAt.getTime() - b.orderItem.createdAt.getTime())
              .map((l) => ({ name: l.orderItem.product.name, quantity: l.quantity })),
          })),
          stale: !sumSubtotals(parts.map((part) => part.amount.toString())).equals(summary.total),
        }
      : null,
    unsent: summary.unsent,
    notServed: summary.notServed,
    settleBlocker: editable ? summary.settleBlocker : "This order is closed.",
  };
}
