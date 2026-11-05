import "server-only";
import { prisma } from "@/lib/db";

export type DiningAreaRow = {
  id: string;
  name: string;
  warehouseId: string;
  warehouseName: string;
  // Active tables only, counted by the DB.
  tableCount: number;
};

// Active areas in floor-plan order, each with its warehouse and table count.
export async function getDiningAreas(): Promise<DiningAreaRow[]> {
  const areas = await prisma.diningArea.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      name: true,
      warehouseId: true,
      warehouse: { select: { name: true } },
      _count: { select: { tables: { where: { deletedAt: null } } } },
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return areas.map((area) => ({
    id: area.id,
    name: area.name,
    warehouseId: area.warehouseId,
    warehouseName: area.warehouse.name,
    tableCount: area._count.tables,
  }));
}
