import "server-only";
import { prisma } from "@/lib/db";
import { BUSINESS_SETTINGS_ID } from "@/lib/business-settings";
import { isModuleEnabled } from "@/lib/modules/enabled.server";
import { departmentOf, type Department } from "../../lib/posGrid";
import { buildPosMenu } from "../../lib/posMenu";
import { menuAvailability } from "../../lib/menuAvailability";
import { MENU_STRINGS } from "../../lib/menuStrings";
import {
  addsTax,
  allergensOf,
  formatMenuPrice,
  looksLikeToken,
  menuMedia,
  menuSections,
  optionPrice,
  photoUrls,
  priceNotes,
  shownOnMenu,
  statusOf,
  toKobo,
  type MenuStatuses,
  type PublicMenuHeader,
  type PublicMenuItem,
  type PublicMenuSection,
  type PublicMenuWhere,
} from "../../lib/publicMenu";
import { restaurantModule } from "../../manifest";
import { businessName } from "../businessName";
import { recipeSelect } from "../menuStock";
import { getModifierGroupsFor } from "./modifiers";
import { guestServiceState, type ServiceButtons } from "../services/tableRequests";
import type { GuestRequests } from "../../lib/tableRequests";
import { guestOrderingFor, type GuestOrdering } from "../services/guestOrders";

// The guest's digital menu (Part 8 Step 3) — public, so every query here
// selects only what a guest may see. A QR token says which table (or QR
// point) and nothing else; a rotated, removed or made-up one finds nothing.

type Where = PublicMenuWhere & { warehouseId: string | null; serviceCharge: boolean };

// The table (live, in a live area) or QR point (live) a token opens.
export async function resolveMenuToken(token: string): Promise<Where | null> {
  if (!looksLikeToken(token)) return null;
  const [table, point] = await Promise.all([
    prisma.table.findFirst({ where: { qrToken: token, deletedAt: null, area: { deletedAt: null } }, select: { name: true, area: { select: { name: true, warehouseId: true } } } }),
    prisma.qrPoint.findFirst({ where: { qrToken: token, deletedAt: null }, select: { name: true, orderType: true } }),
  ]);
  if (table) return { title: MENU_STRINGS.table(table.name), area: table.area.name, startDepartment: "FOOD", warehouseId: table.area.warehouseId, serviceCharge: true };
  if (point) {
    const setting = await prisma.businessSetting.findUnique({ where: { id: BUSINESS_SETTINGS_ID }, select: { restaurantWarehouseId: true } });
    return { title: point.name, area: null, startDepartment: point.orderType === "BAR_TAB" ? "BAR" : "FOOD", warehouseId: setting?.restaurantWarehouseId ?? null, serviceCharge: point.orderType !== "TAKEAWAY" };
  }
  return null;
}

// Listed items (on the menu, not deleted) and each one's state, by the POS's
// own rule (lib/menuAvailability) in the warehouse the table's orders use.
async function listedItems(warehouseId: string | null) {
  const items = await prisma.product.findMany({
    where: { productType: "MENU_ITEM", deletedAt: null, showOnMenu: true },
    select: {
      id: true,
      name: true,
      menuDescription: true,
      price: true,
      taxType: true,
      orderTax: true,
      isAvailable: true,
      photoPath: true,
      spinFrames: true,
      modelGlbPath: true,
      modelUsdzPath: true,
      mediaType: true,
      allergens: true,
      calories: true,
      isSignature: true,
      menuGroupId: true,
      menuGridPosition: true,
      prepStation: true,
      kitchenStation: { select: { code: true } },
      category: { select: { id: true, name: true } },
      recipeLines: recipeSelect,
    },
    orderBy: { name: "asc" },
  });
  const stockIds = [...new Set(items.flatMap((d) => (d.recipeLines.length ? d.recipeLines.map((r) => r.ingredientId) : [d.id])))];
  const stock = new Map(
    warehouseId && stockIds.length
      ? (await prisma.productStock.findMany({ where: { warehouseId, productId: { in: stockIds } }, select: { productId: true, quantity: true } })).map((r) => [r.productId, r.quantity.toString()])
      : [],
  );
  return items.map((item) => ({
    item,
    status: statusOf(
      menuAvailability({
        isAvailable: item.isAvailable,
        recipe: item.recipeLines.map((r) => ({ quantity: r.quantity.toString(), stock: stock.get(r.ingredientId) ?? "0" })),
        ownStock: stock.get(item.id) ?? "0",
      }),
    ),
  }));
}

const settingsSelect = {
  menuEnabled: true,
  showPrices: true,
  showSoldOut: true,
  showCalories: true,
  showAllergens: true,
  menuTitle: true,
  welcomeText: true,
  footerText: true,
  logoPath: true,
  accentColour: true,
  currencyDisplay: true,
  menuDesign: true,
} as const;

// The guest menu's look, on its own (the page's theme colour needs it
// before the menu loads). No settings row yet: Showcase.
export async function menuDesign(): Promise<"SHOWCASE" | "CLASSIC"> {
  const settings = await prisma.menuSettings.findUnique({ where: { businessId: BUSINESS_SETTINGS_ID }, select: { menuDesign: true } });
  return settings?.menuDesign ?? "SHOWCASE";
}

export type PublicMenuPage =
  | { kind: "off" }
  | { kind: "inactive" }
  | { kind: "closed"; title: string }
  | {
      kind: "menu";
      // Showcase (the default) or Classic (Digital menu › QR codes).
      design: "SHOWCASE" | "CLASSIC";
      where: PublicMenuWhere;
      header: PublicMenuHeader;
      sections: PublicMenuSection[];
      items: PublicMenuItem[];
      departments: Department[];
      showSoldOut: boolean;
      // Call waiter / Request bill (Step 6): tables only, when switched on.
      service: { buttons: ServiceButtons; requests: GuestRequests } | null;
      // Guest ordering (Step 7): tables only, when switched on.
      ordering: GuestOrdering | null;
    };

export async function loadPublicMenu(token: string): Promise<PublicMenuPage> {
  if (!(await isModuleEnabled(restaurantModule.id))) return { kind: "off" };
  const where = await resolveMenuToken(token);
  if (!where) return { kind: "inactive" };
  const [settings, business, setting] = await Promise.all([
    prisma.menuSettings.findUnique({ where: { businessId: BUSINESS_SETTINGS_ID }, select: settingsSelect }),
    businessName(),
    prisma.businessSetting.findUnique({ where: { id: BUSINESS_SETTINGS_ID }, select: { restaurantServiceChargePercent: true } }),
  ]);
  const title = settings?.menuTitle?.trim() || business;
  if (settings && !settings.menuEnabled) return { kind: "closed", title };

  const showSoldOut = settings?.showSoldOut ?? true;
  const [rows, menuGroups, service, ordering] = await Promise.all([
    listedItems(where.warehouseId),
    prisma.menuGroup.findMany({ where: { deletedAt: null }, select: { id: true, name: true, parentId: true, department: true, colour: true, rank: true, gridPosition: true } }),
    guestServiceState(token),
    guestOrderingFor(token),
  ]);
  const shown = rows.filter((r) => shownOnMenu(r.status, showSoldOut));
  const tree = buildPosMenu(
    menuGroups,
    shown.map(({ item }) => ({
      id: item.id,
      name: item.name,
      categoryId: item.category.id,
      categoryName: item.category.name,
      groupId: item.menuGroupId,
      gridPosition: item.menuGridPosition,
      stationDepartment: departmentOf(item.kitchenStation?.code ?? null, item.prepStation),
    })),
  );
  const { sections, order, sectionOf } = menuSections(tree, new Set(shown.map((r) => r.item.id)));
  const byId = new Map(shown.map((r) => [r.item.id, r]));
  // Their option groups, as the POS shows them (Part 8 Step 4: read-only).
  const groups = await getModifierGroupsFor(order);
  const display = settings?.currencyDisplay ?? "SYMBOL";
  const showPrices = settings?.showPrices !== false;
  const items = order.map((id): PublicMenuItem => {
    const { item, status } = byId.get(id)!;
    const media = menuMedia(item.id, item);
    return {
      id: item.id,
      name: item.name,
      description: item.menuDescription?.trim() || null,
      price: showPrices ? formatMenuPrice(item.price.toString(), display) : null,
      kobo: showPrices ? toKobo(item.price.toString()) : null,
      status,
      photo: photoUrls(item.id, item.photoPath),
      signature: item.isSignature,
      spin: media.spinFrames !== null,
      model: media.modelFiles !== null,
      spinFrames: media.spinFrames,
      modelFiles: media.modelFiles,
      modifiers: (groups[item.id] ?? []).map((g) => ({
        id: g.id,
        name: g.name,
        rule: g.rule,
        min: g.minSelect,
        max: g.maxSelect,
        options: g.options.map((o) => ({ id: o.id, name: o.name, price: optionPrice(o.price, display, showPrices), kobo: showPrices ? toKobo(o.value) : null })),
      })),
      allergens: settings?.showAllergens === false ? [] : allergensOf(item.allergens),
      calories: settings?.showCalories === false ? null : item.calories,
      department: tree.dishDepartment[item.id] ?? "FOOD",
      sectionId: sectionOf[item.id],
    };
  });
  const departments = (["FOOD", "BAR"] as const).filter((d) => items.some((i) => i.department === d));
  return {
    kind: "menu",
    design: settings?.menuDesign ?? "SHOWCASE",
    where: { title: where.title, area: where.area, startDepartment: departments.includes(where.startDepartment) ? where.startDepartment : (departments[0] ?? "FOOD") },
    header: {
      title,
      welcome: settings?.welcomeText?.trim() || null,
      footer: settings?.footerText?.trim() || null,
      logo: settings?.logoPath ? "/menu/media/logo" : null,
      accent: /^#[0-9a-f]{6}$/i.test(settings?.accentColour ?? "") ? settings!.accentColour : "#0f7d6a",
      notes: settings?.showPrices === false ? [] : priceNotes({ anyTaxAdded: shown.some((r) => addsTax({ taxType: r.item.taxType, orderTax: r.item.orderTax?.toString() ?? null })), servicePercent: where.serviceCharge ? (setting?.restaurantServiceChargePercent?.toString() ?? null) : null }),
    },
    sections,
    items,
    departments,
    showSoldOut,
    service,
    ordering,
  };
}

// The live check (every 30 s, and when the page comes back into view):
// each listed item's state, nothing else. Null: the menu is off, closed or
// the code no longer works (the page then reloads to say so).
export async function loadMenuStatuses(token: string): Promise<MenuStatuses | null> {
  if (!(await isModuleEnabled(restaurantModule.id))) return null;
  const where = await resolveMenuToken(token);
  if (!where) return null;
  const settings = await prisma.menuSettings.findUnique({ where: { businessId: BUSINESS_SETTINGS_ID }, select: { menuEnabled: true, showSoldOut: true } });
  if (settings && !settings.menuEnabled) return null;
  const rows = await listedItems(where.warehouseId);
  return Object.fromEntries(rows.filter((r) => shownOnMenu(r.status, settings?.showSoldOut ?? true)).map((r) => [r.item.id, r.status]));
}
