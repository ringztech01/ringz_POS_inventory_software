import { Decimal } from "@prisma/client/runtime/index-browser";
import type { PaymentType } from "@prisma/client";
import { formatNaira } from "@/lib/format";
import type { ZReportTicket } from "@/lib/hardware/tickets";

// A till's figures and its Z-report (Part 6f Step 7b) — the same rows on
// screen and on paper. Pure.

const money = (d: Decimal.Value) => formatNaira(new Decimal(d).toFixed(2));
// "-₦25.00" — or "₦0.00" when there's nothing to take off.
export const minus = (d: Decimal.Value) => (new Decimal(d).isZero() ? money(0) : `-${money(d)}`);

export type TillFigures = {
  float: string;
  cashSales: string;
  cashTips: string;
  cashRefunds: string;
  expected: string;
  byMethod: { method: PaymentType; label: string; amount: string; count: number }[];
  tipsByMethod: { method: PaymentType; label: string; amount: string }[];
  refunds: { count: number; amount: string };
  drawerByHand: number;
};

export type TillSummary = {
  id: string;
  openedBy: string;
  openedAt: string;
  closedBy: string | null;
  closedAt: string | null;
  figures: TillFigures;
  counted: string | null;
  variance: string | null;
  result: string | null;
  note: string | null;
  zPrinted: boolean;
};

// The Z-report: what the screen shows after the close, and what prints.
export function zReport(till: string, s: TillSummary): ZReportTicket {
  const f = s.figures;
  return {
    till,
    openedBy: s.openedBy,
    openedAt: s.openedAt,
    closedBy: s.closedBy ?? "",
    closedAt: s.closedAt ?? s.openedAt,
    sections: [
      {
        heading: "Cash",
        rows: [
          ["Float", money(f.float)],
          ["Cash taken", money(f.cashSales)],
          ["Cash tips", money(f.cashTips)],
          ["Cash refunds", minus(f.cashRefunds)],
          ["Expected in drawer", money(f.expected)],
          ["Counted", money(s.counted ?? "0")],
        ],
      },
      { heading: "Takings", rows: f.byMethod.filter((m) => m.count > 0 || m.method === "CASH").map((m) => [`${m.label} (${m.count})`, money(m.amount)] as [string, string]) },
      {
        heading: "Also",
        rows: [
          ["Tips (all methods)", money(f.tipsByMethod.reduce((d, t) => d.plus(t.amount), new Decimal(0)))],
          [`Refunds (${f.refunds.count})`, money(f.refunds.amount)],
          ["Drawer opened by hand", String(f.drawerByHand)],
        ],
      },
    ],
    result: s.result ?? "",
    note: s.note,
  };
}
