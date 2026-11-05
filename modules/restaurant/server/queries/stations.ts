import "server-only";
import { prisma } from "@/lib/db";
import { openLinesAt } from "../services/stations";

export type StationRow = {
  id: string;
  name: string;
  code: string;
  lateAfterMin: number;
  sortOrder: number;
  isActive: boolean;
  // Menu items made here, and lines in its kitchen right now (Sent,
  // Preparing or Ready) — a station with open lines can't be deleted.
  dishes: number;
  openLines: number;
};

// Stations settings: every station that isn't deleted, in station order.
export async function getStationList(): Promise<StationRow[]> {
  const stations = await prisma.kitchenStation.findMany({
    where: { deletedAt: null },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      code: true,
      lateAfterMin: true,
      sortOrder: true,
      isActive: true,
      _count: { select: { products: { where: { deletedAt: null } } } },
    },
  });
  const open = await Promise.all(stations.map((s) => openLinesAt(prisma, s.id)));
  return stations.map(({ _count, ...s }, i) => ({ ...s, dishes: _count.products, openLines: open[i] }));
}

// For the menu-item form's "Kitchen station" select: the active stations.
export async function getStationOptions(): Promise<{ value: string; label: string }[]> {
  const stations = await prisma.kitchenStation.findMany({
    where: { deletedAt: null, isActive: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true, name: true, code: true },
  });
  return stations.map((s) => ({ value: s.id, label: `${s.name} (${s.code})` }));
}
