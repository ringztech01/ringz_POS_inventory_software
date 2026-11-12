import "server-only";
import { Decimal } from "@prisma/client/runtime/index-browser";
import { prisma } from "@/lib/db";
import { BUSINESS_SETTINGS_ID } from "@/lib/business-settings";
import { formatNaira } from "@/lib/format";
import { readQuickNotes } from "../../lib/optionFlow";
import { departmentOf } from "../../lib/posGrid";
import type { MenuDishRow, MenuGroupRow } from "../../lib/posMenu";

export type EditorDish = MenuDishRow & { price: string; off: boolean };

export type ButtonEditorData = {
  groups: MenuGroupRow[];
  dishes: EditorDish[];
  quickNotes: string[];
};

// The Note keypad's quick notes (the saved list, or the defaults). Read on
// its own — not part of getBusinessSettings, which every page reads.
export async function getQuickNotes(): Promise<string[]> {
  const row = await prisma.businessSetting.findUnique({ where: { id: BUSINESS_SETTINGS_ID }, select: { restaurantQuickNotes: true } });
  return readQuickNotes(row?.restaurantQuickNotes ?? null);
}

// Food › POS buttons: the live groups and menu items as the editor needs
// them (the same rows the POS builds its tree from — lib/posMenu).
export async function getButtonEditor(): Promise<ButtonEditorData> {
  const [groups, items, quickNotes] = await Promise.all([
    prisma.menuGroup.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, parentId: true, department: true, colour: true, rank: true, gridPosition: true },
      orderBy: [{ rank: "asc" }, { name: "asc" }],
    }),
    prisma.product.findMany({
      where: { productType: "MENU_ITEM", deletedAt: null },
      select: {
        id: true,
        name: true,
        price: true,
        isAvailable: true,
        prepStation: true,
        kitchenStation: { select: { code: true } },
        menuGroupId: true,
        menuGridPosition: true,
        category: { select: { id: true, name: true } },
      },
      orderBy: [{ category: { name: "asc" } }, { name: "asc" }],
    }),
    getQuickNotes(),
  ]);
  const live = new Set(groups.map((g) => g.id));
  return {
    groups,
    dishes: items.map((item) => ({
      id: item.id,
      name: item.name,
      price: formatNaira(new Decimal(item.price.toString()).toFixed(2)),
      off: !item.isAvailable,
      categoryId: item.category.id,
      categoryName: item.category.name,
      groupId: item.menuGroupId && live.has(item.menuGroupId) ? item.menuGroupId : null,
      gridPosition: item.menuGridPosition,
      stationDepartment: departmentOf(item.kitchenStation?.code ?? null, item.prepStation),
    })),
    quickNotes,
  };
}
