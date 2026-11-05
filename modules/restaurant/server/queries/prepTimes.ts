import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { DateRange } from "@/lib/dateRanges";
import { periodBounds } from "../../lib/dashboard";

// Prep times, aggregated in the database over the lines that became Ready
// in the range (cancelled and removed lines, and deleted orders, left out):
//   wait = sent → started, cook = started → ready, total = sent → ready
// (seconds; a line that skipped Preparing has no wait or cook). Late: total
// over the line's station limit (15 min for a line with no station). The
// dashboard's Avg prep time tile reads getPrepSummary too.

const DEFAULT_LATE_MIN = 15;

export type PrepStats = {
  lines: number;
  quantity: number;
  avgWait: number | null;
  avgCook: number | null;
  avgTotal: number | null;
  maxTotal: number | null;
  late: number;
};

export type PrepGroup = PrepStats & { id: string | null; name: string };

export type PrepTimeReport = { summary: PrepStats; byStation: PrepGroup[]; byDish: PrepGroup[] };

// `lineCount`, not `lines`: that's a reserved word in MariaDB.
type StatsRow = {
  lineCount: bigint | number;
  quantity: Prisma.Decimal | number | null;
  avgWait: Prisma.Decimal | number | null;
  avgCook: Prisma.Decimal | number | null;
  avgTotal: Prisma.Decimal | number | null;
  maxTotal: bigint | number | null;
  late: Prisma.Decimal | number | null;
};

const num = (value: Prisma.Decimal | bigint | number | null) => (value === null ? null : Number(value));
const toStats = (row: StatsRow | undefined): PrepStats => ({
  lines: Number(row?.lineCount ?? 0),
  quantity: num(row?.quantity ?? null) ?? 0,
  avgWait: num(row?.avgWait ?? null),
  avgCook: num(row?.avgCook ?? null),
  avgTotal: num(row?.avgTotal ?? null),
  maxTotal: num(row?.maxTotal ?? null),
  late: num(row?.late ?? null) ?? 0,
});

const STATS = Prisma.sql`
  COUNT(*) AS lineCount,
  SUM(i.quantity) AS quantity,
  AVG(TIMESTAMPDIFF(SECOND, i.sentAt, i.startedAt)) AS avgWait,
  AVG(TIMESTAMPDIFF(SECOND, i.startedAt, i.readyAt)) AS avgCook,
  AVG(TIMESTAMPDIFF(SECOND, i.sentAt, i.readyAt)) AS avgTotal,
  MAX(TIMESTAMPDIFF(SECOND, i.sentAt, i.readyAt)) AS maxTotal,
  SUM(TIMESTAMPDIFF(SECOND, i.sentAt, i.readyAt) > COALESCE(s.lateAfterMin, ${DEFAULT_LATE_MIN}) * 60) AS late`;

// The lines cooked in the range (and at the station), plus any extra join.
function cooked(range: DateRange, stationId: string | null, join: Prisma.Sql = Prisma.empty) {
  const { start, end } = periodBounds(range);
  return Prisma.sql`
    FROM OrderItem i
    JOIN \`Order\` o ON o.id = i.orderId
    LEFT JOIN KitchenStation s ON s.id = i.stationId
    ${join}
    WHERE i.readyAt >= ${start} AND i.readyAt < ${end} AND i.sentAt IS NOT NULL
      AND i.deletedAt IS NULL AND i.cancelledAt IS NULL AND o.deletedAt IS NULL
      ${stationId ? Prisma.sql`AND i.stationId = ${stationId}` : Prisma.empty}`;
}

// Items cooked, average total, late count — one row.
export async function getPrepSummary(range: DateRange, stationId: string | null = null): Promise<PrepStats> {
  const [row] = await prisma.$queryRaw<StatsRow[]>`SELECT ${STATS} ${cooked(range, stationId)}`;
  return toStats(row);
}

// The report: the summary, by station (station order), and by dish
// (slowest average first).
export async function getPrepTimeReport(range: DateRange, stationId: string | null = null): Promise<PrepTimeReport> {
  const [summary, stations, dishes] = await Promise.all([
    getPrepSummary(range, stationId),
    prisma.$queryRaw<(StatsRow & { id: string | null; name: string | null })[]>`
      SELECT s.id AS id, s.name AS name, ${STATS} ${cooked(range, stationId)}
      GROUP BY s.id, s.name, s.sortOrder
      ORDER BY s.sortOrder IS NULL, s.sortOrder, s.name`,
    prisma.$queryRaw<(StatsRow & { id: string; name: string })[]>`
      SELECT p.id AS id, p.name AS name, ${STATS} ${cooked(range, stationId, Prisma.sql`JOIN Product p ON p.id = i.productId`)}
      GROUP BY p.id, p.name
      ORDER BY avgTotal DESC, p.name`,
  ]);
  return {
    summary,
    byStation: stations.map((row) => ({ ...toStats(row), id: row.id, name: row.name ?? "No station" })),
    byDish: dishes.map((row) => ({ ...toStats(row), id: row.id, name: row.name })),
  };
}

// The report's station filter: every station not deleted (inactive ones
// still have history), in station order.
export async function getReportStations(): Promise<{ id: string; name: string }[]> {
  return prisma.kitchenStation.findMany({
    where: { deletedAt: null },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true, name: true },
  });
}
