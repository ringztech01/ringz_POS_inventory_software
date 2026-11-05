// Sample restaurant data from the RingzPOS restaurant designs: dining areas
// and tables (Main hall T1–T12, Patio P1–P4, Bar B1–B4), the menu with its
// modifiers and recipes, ingredients with stock, some open orders,
// today's reservations and some waste logged earlier today.
//
// Run with: npx tsx modules/restaurant/seed.ts [--warehouse "<name>"] [--user <email>]
//   --warehouse  where the areas and stock go (default: the oldest active one)
//   --user       the waiter on the sample orders and the reservations' creator
//                (default: the oldest active user)
//
// Safe to re-run: lookups are found or created, products are upserted by
// code without overwriting edits, and orders / reservations / waste are only
// added while there are none. It never creates warehouses or users.
import { prisma } from "@/lib/db";
import { todayInAppZone } from "@/lib/dateRanges";
import { Prisma, type KitchenStatus, type OrderStatus, type OrderType, type PrepStation, type WasteReason } from "@prisma/client";
import { decreaseStock, increaseStock } from "@/lib/stock";
import { newQrToken } from "./lib/qrToken";

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

// ---- Data (from the design files) ----------------------------------------

const MENU_CATEGORIES = ["Starters", "Mains", "Grill", "Sides", "Drinks"];
const INGREDIENT_CATEGORY = "Ingredients";
const BRAND = "Ringz Kitchen";

// name, code, unit, cost per unit, stock, alert. Stock is whole units (as
// all product stock is); the low ones match the dashboard design's list.
const INGREDIENTS: [string, string, string, string, number, number][] = [
  ["Basmati rice", "IN-001", "kg", "2.20", 6, 10],
  ["Chicken thighs", "IN-002", "kg", "6.00", 3, 10],
  ["Tomato base", "IN-003", "L", "4.00", 20, 5],
  ["Plantain", "IN-004", "pc", "0.30", 14, 20],
  ["Tilapia (whole)", "IN-005", "pc", "4.20", 8, 12],
  ["Pepper mix", "IN-006", "kg", "6.00", 5, 1],
  ["Beef sirloin", "IN-007", "kg", "12.40", 15, 5],
  ["Suya spice", "IN-008", "kg", "8.33", 3, 1],
  ["Chicken wings", "IN-009", "kg", "6.00", 12, 5],
  ["Goat meat", "IN-010", "kg", "11.00", 10, 4],
  ["Pepper soup spice", "IN-011", "kg", "10.00", 2, 1],
  ["Grenadine syrup", "IN-012", "L", "11.67", 0, 2],
  ["Fanta", "IN-013", "btl", "0.60", 48, 24],
];

type MenuSeed = {
  name: string;
  code: string;
  category: string;
  price: string;
  station: PrepStation;
  available: boolean;
  onMenu: boolean;
  groups: string[];
  description?: string;
  recipe: [string, string][];
};

const MENU: MenuSeed[] = [
  { name: "Jollof Rice & Chicken", code: "MN-001", category: "Mains", price: "18.00", station: "KITCHEN", available: true, onMenu: true, groups: ["Portion", "Extras"], description: "Smoky party jollof with grilled chicken thigh and fried plantain.", recipe: [["Basmati rice", "0.25"], ["Chicken thighs", "0.3"], ["Tomato base", "0.1"], ["Plantain", "1"]] },
  { name: "Grilled Tilapia", code: "MN-002", category: "Mains", price: "26.00", station: "KITCHEN", available: true, onMenu: true, groups: ["Portion", "Spice level"], description: "Whole tilapia with pepper sauce, served with chips or yam.", recipe: [["Tilapia (whole)", "1"], ["Pepper mix", "0.05"]] },
  { name: "Fried Rice & Turkey", code: "MN-003", category: "Mains", price: "20.00", station: "KITCHEN", available: true, onMenu: true, groups: ["Portion"], description: "Vegetable fried rice with peppered turkey wings.", recipe: [] },
  { name: "Staff Meal", code: "MN-099", category: "Mains", price: "5.00", station: "KITCHEN", available: true, onMenu: false, groups: [], recipe: [["Basmati rice", "0.2"]] },
  { name: "Beef Suya Platter", code: "GR-001", category: "Grill", price: "18.00", station: "KITCHEN", available: true, onMenu: true, groups: ["Spice level"], description: "Spiced beef skewers with onions and tomatoes.", recipe: [["Beef sirloin", "0.25"], ["Suya spice", "0.03"]] },
  { name: "Chicken Wings", code: "GR-002", category: "Grill", price: "14.00", station: "KITCHEN", available: false, onMenu: true, groups: ["Sauce"], description: "Six wings, choice of sauce.", recipe: [["Chicken wings", "0.4"]] },
  { name: "Pepper Soup", code: "ST-001", category: "Starters", price: "12.00", station: "KITCHEN", available: true, onMenu: true, groups: ["Protein"], description: "Goat or catfish in a light, spicy broth.", recipe: [["Goat meat", "0.2"], ["Pepper soup spice", "0.02"]] },
  { name: "Spring Rolls", code: "ST-002", category: "Starters", price: "8.00", station: "KITCHEN", available: true, onMenu: true, groups: [], description: "Four crisp vegetable rolls with sweet chili dip.", recipe: [] },
  { name: "Puff-Puff", code: "ST-003", category: "Starters", price: "5.00", station: "KITCHEN", available: true, onMenu: false, groups: [], recipe: [] },
  { name: "Plantain Side", code: "SD-001", category: "Sides", price: "4.00", station: "KITCHEN", available: true, onMenu: false, groups: [], recipe: [] },
  { name: "Coleslaw", code: "SD-002", category: "Sides", price: "3.00", station: "KITCHEN", available: true, onMenu: false, groups: [], recipe: [] },
  { name: "Chapman", code: "DR-001", category: "Drinks", price: "6.00", station: "BAR", available: true, onMenu: true, groups: [], description: "House fruit punch over ice.", recipe: [["Grenadine syrup", "0.03"], ["Fanta", "1"]] },
  { name: "Zobo", code: "DR-002", category: "Drinks", price: "4.00", station: "BAR", available: true, onMenu: true, groups: [], description: "Chilled hibiscus with ginger.", recipe: [] },
  { name: "Bottled Water", code: "DR-004", category: "Drinks", price: "2.00", station: "BAR", available: true, onMenu: true, groups: [], recipe: [] },
];

// Portion and Extras are from the order screen's options modal; the other
// groups' choices are filled in (the designs only name them).
const MODIFIER_GROUPS: { name: string; min: number; max: number; options: [string, string][] }[] = [
  { name: "Portion", min: 1, max: 1, options: [["Regular", "0"], ["Large", "4.00"]] },
  { name: "Extras", min: 0, max: 2, options: [["Extra plantain", "2.00"], ["Coleslaw", "1.50"]] },
  { name: "Spice level", min: 1, max: 1, options: [["Mild", "0"], ["Medium", "0"], ["Hot", "0"]] },
  { name: "Sauce", min: 1, max: 1, options: [["Pepper sauce", "0"], ["BBQ", "0"], ["Honey glaze", "0"]] },
  { name: "Protein", min: 1, max: 1, options: [["Goat", "0"], ["Catfish", "0"]] },
];

// Area → tables [name, seats]; T6 and P4 are waiting to be cleaned.
const AREAS: [string, [string, number][]][] = [
  ["Main hall", [["T1", 2], ["T2", 4], ["T3", 4], ["T4", 4], ["T5", 6], ["T6", 2], ["T7", 2], ["T8", 4], ["T9", 8], ["T10", 4], ["T11", 6], ["T12", 2]]],
  ["Patio", [["P1", 4], ["P2", 4], ["P3", 2], ["P4", 6]]],
  ["Bar", [["B1", 2], ["B2", 2], ["B3", 2], ["B4", 2]]],
];
const NEEDS_CLEANING = new Set(["T6", "P4"]);

// Open orders as on the floor plan, dashboard and kitchen display designs.
// Lines: [menu item, qty, kitchen status, note?, modifiers?].
type LineSeed = [string, number, KitchenStatus, string?, [string, string][]?];
const ORDERS: { table: string | null; type: OrderType; status: OrderStatus; guests: number; minutesAgo: number; lines: LineSeed[] }[] = [
  { table: "T2", type: "DINE_IN", status: "OPEN", guests: 3, minutesAgo: 6, lines: [["Pepper Soup", 1, "NEW", undefined, [["Protein", "Goat"]]], ["Spring Rolls", 1, "NEW"], ["Chapman", 1, "NEW"]] },
  { table: "T4", type: "DINE_IN", status: "SERVED", guests: 4, minutesAgo: 58, lines: [["Jollof Rice & Chicken", 2, "SERVED", undefined, [["Portion", "Regular"]]], ["Grilled Tilapia", 1, "SERVED", "no pepper", [["Portion", "Regular"], ["Spice level", "Mild"]]], ["Chapman", 3, "SERVED"]] },
  { table: "T7", type: "DINE_IN", status: "SENT", guests: 2, minutesAgo: 22, lines: [["Beef Suya Platter", 1, "PENDING", "Extra onions", [["Spice level", "Medium"]]], ["Zobo", 2, "READY"]] },
  { table: "T11", type: "DINE_IN", status: "SENT", guests: 6, minutesAgo: 17, lines: [["Jollof Rice & Chicken", 4, "PREPARING", undefined, [["Portion", "Regular"]]], ["Pepper Soup", 2, "READY", undefined, [["Protein", "Goat"]]], ["Chapman", 6, "PENDING"]] },
  { table: "P2", type: "DINE_IN", status: "SENT", guests: 3, minutesAgo: 6, lines: [["Spring Rolls", 2, "PENDING"], ["Puff-Puff", 1, "PENDING"]] },
  { table: "B1", type: "DINE_IN", status: "SERVED", guests: 2, minutesAgo: 41, lines: [["Chapman", 2, "SERVED", "Less ice"], ["Beef Suya Platter", 2, "SERVED", undefined, [["Spice level", "Hot"]]]] },
  { table: null, type: "TAKEAWAY", status: "SENT", guests: 1, minutesAgo: 9, lines: [["Fried Rice & Turkey", 2, "PENDING", undefined, [["Portion", "Regular"]]], ["Plantain Side", 2, "PENDING"]] },
  { table: null, type: "DELIVERY", status: "SENT", guests: 1, minutesAgo: 2, lines: [["Jollof Rice & Chicken", 3, "PENDING", "Pack separately", [["Portion", "Regular"]]]] },
];

// Today's bookings (Tables design): time, name, party, phone, table, status.
const RESERVATIONS: [string, string, number, string, string, "BOOKED" | "NO_SHOW"][] = [
  ["19:00", "Adeyemi", 2, "0803 214 7781", "T8", "BOOKED"],
  ["19:30", "Okafor", 6, "0812 554 0192", "T5", "BOOKED"],
  ["20:00", "Bello", 4, "0705 300 8841", "T10", "BOOKED"],
  ["18:00", "Nwosu", 3, "0809 771 2200", "P3", "NO_SHOW"],
];

// Waste logged earlier today (Restaurant › Food › Waste): raw ingredients and
// a dish with no recipe — whole units, as stock is; none of the dashboard's
// low-stock five — one with a note, and one voided (its stock put back).
// Each takes its stock out as logged: item, qty in its own unit.
const WASTE: { item: string; qty: number; reason: WasteReason; note?: string; minutesAgo: number; voided?: string }[] = [
  { item: "Fanta", qty: 2, reason: "EXPIRED", minutesAgo: 50 },
  { item: "Goat meat", qty: 1, reason: "EXPIRED", minutesAgo: 45 },
  { item: "Spring Rolls", qty: 4, reason: "OVERPRODUCTION", minutesAgo: 35 },
  { item: "Chicken wings", qty: 1, reason: "OTHER", note: "Freezer door left open overnight", minutesAgo: 25 },
  { item: "Beef sirloin", qty: 1, reason: "BURNT", minutesAgo: 15, voided: "Logged on the wrong item" },
];

// ---- Helpers --------------------------------------------------------------

async function category(name: string) {
  const found = await prisma.category.findFirst({ where: { name, deletedAt: null } });
  return found ?? prisma.category.create({ data: { name } });
}

async function brand(name: string) {
  const found = await prisma.brand.findFirst({ where: { name, deletedAt: null } });
  return found ?? prisma.brand.create({ data: { name } });
}

async function unit(name: string) {
  const found = await prisma.unit.findFirst({ where: { name, deletedAt: null } });
  return found ?? prisma.unit.create({ data: { name } });
}

const minutesBefore = (now: Date, minutes: number) => new Date(now.getTime() - minutes * 60_000);

// ---- Seed -----------------------------------------------------------------

async function main() {
  const warehouseName = flag("warehouse");
  const warehouse = await prisma.warehouse.findFirst({
    where: { deletedAt: null, ...(warehouseName ? { name: warehouseName } : {}) },
    orderBy: { createdAt: "asc" },
  });
  if (!warehouse) throw new Error(warehouseName ? `No active warehouse named "${warehouseName}".` : "No active warehouse.");

  const userEmail = flag("user");
  const user = await prisma.user.findFirst({
    where: { deletedAt: null, ...(userEmail ? { email: userEmail } : {}) },
    orderBy: { createdAt: "asc" },
  });
  if (!user) throw new Error(userEmail ? `No active user with email ${userEmail}.` : "No active user.");

  console.log(`Warehouse: ${warehouse.name} · user: ${user.firstName} ${user.lastName}`);

  const kitchenBrand = await brand(BRAND);
  const categories = new Map<string, string>();
  for (const name of [...MENU_CATEGORIES, INGREDIENT_CATEGORY]) categories.set(name, (await category(name)).id);
  const units = new Map<string, string>();
  for (const name of new Set(["pc", ...INGREDIENTS.map((row) => row[2])])) units.set(name, (await unit(name)).id);

  // The kitchen stations (the add_kitchen_stations_kots migration makes KIT
  // and BAR); a menu item's station is the one for its prepStation.
  const stations = new Map(
    (await prisma.kitchenStation.findMany({ where: { deletedAt: null }, select: { id: true, code: true } })).map((s) => [s.code, s.id]),
  );
  const stationFor = (station: PrepStation) => stations.get(station === "BAR" ? "BAR" : "KIT") ?? null;

  // Ingredients, with their stock in the warehouse.
  const products = new Map<string, { id: string; price: Prisma.Decimal; station: PrepStation | null; stationId: string | null }>();
  for (const [name, code, unitName, cost, stock, alert] of INGREDIENTS) {
    const product = await prisma.product.upsert({
      where: { code },
      update: {},
      create: {
        name,
        code,
        price: "0",
        cost,
        stockAlert: alert,
        taxType: "EXCLUSIVE",
        productType: "INGREDIENT",
        categoryId: categories.get(INGREDIENT_CATEGORY)!,
        brandId: kitchenBrand.id,
        unitId: units.get(unitName)!,
      },
    });
    await prisma.productStock.upsert({
      where: { productId_warehouseId: { productId: product.id, warehouseId: warehouse.id } },
      update: {},
      create: { productId: product.id, warehouseId: warehouse.id, quantity: stock },
    });
    products.set(name, { id: product.id, price: product.price, station: null, stationId: null });
  }

  // Modifier groups and their choices.
  const groups = new Map<string, { id: string; options: Map<string, Prisma.Decimal> }>();
  for (const [index, group] of MODIFIER_GROUPS.entries()) {
    const found = await prisma.modifierGroup.findFirst({
      where: { name: group.name, deletedAt: null },
      include: { modifiers: { where: { deletedAt: null } } },
    });
    const row =
      found ??
      (await prisma.modifierGroup.create({
        data: {
          name: group.name,
          minSelect: group.min,
          maxSelect: group.max,
          sortOrder: index,
          modifiers: { create: group.options.map(([name, price], order) => ({ name, price, sortOrder: order })) },
        },
        include: { modifiers: { where: { deletedAt: null } } },
      }));
    groups.set(group.name, { id: row.id, options: new Map(row.modifiers.map((m) => [m.name, m.price])) });
  }

  // Menu items. Groups and recipes are attached only when the item is new,
  // so a re-run never overwrites changes made in the app.
  let newItems = 0;
  for (const item of MENU) {
    const existing = await prisma.product.findUnique({ where: { code: item.code } });
    const product =
      existing ??
      (await prisma.product.create({
        data: {
          name: item.name,
          code: item.code,
          price: item.price,
          taxType: "EXCLUSIVE",
          productType: "MENU_ITEM",
          showOnMenu: item.onMenu,
          isAvailable: item.available,
          prepStation: item.station,
          stationId: stationFor(item.station),
          menuDescription: item.description ?? null,
          categoryId: categories.get(item.category)!,
          brandId: kitchenBrand.id,
          unitId: units.get("pc")!,
          modifierGroups: { connect: item.groups.map((name) => ({ id: groups.get(name)!.id })) },
          recipeLines: {
            create: item.recipe.map(([ingredient, quantity]) => ({ ingredientId: products.get(ingredient)!.id, quantity })),
          },
        },
      }));
    if (!existing) newItems++;
    // An item without a recipe is sold from its own stock.
    if (item.recipe.length === 0) {
      await prisma.productStock.upsert({
        where: { productId_warehouseId: { productId: product.id, warehouseId: warehouse.id } },
        update: {},
        create: { productId: product.id, warehouseId: warehouse.id, quantity: 40 },
      });
    }
    products.set(item.name, { id: product.id, price: product.price, station: product.prepStation, stationId: product.stationId });
  }

  // Areas and tables.
  const tables = new Map<string, string>();
  for (const [index, [areaName, rows]] of AREAS.entries()) {
    const area =
      (await prisma.diningArea.findFirst({ where: { name: areaName, warehouseId: warehouse.id, deletedAt: null } })) ??
      (await prisma.diningArea.create({ data: { name: areaName, warehouseId: warehouse.id, sortOrder: index } }));
    for (const [name, seats] of rows) {
      const table =
        (await prisma.table.findFirst({ where: { name, areaId: area.id, deletedAt: null } })) ??
        (await prisma.table.create({
          data: { name, seats, areaId: area.id, qrToken: newQrToken(), needsCleaning: NEEDS_CLEANING.has(name) },
        }));
      tables.set(name, table.id);
    }
  }

  // Open orders, only into an empty Order table.
  const now = new Date();
  let orders = 0;
  if ((await prisma.order.count()) === 0) {
    for (const order of ORDERS) {
      const openedAt = minutesBefore(now, order.minutesAgo);
      const sentAt = minutesBefore(now, Math.max(order.minutesAgo - 2, 1));
      await prisma.order.create({
        data: {
          type: order.type,
          status: order.status,
          tableId: order.table ? tables.get(order.table)! : null,
          warehouseId: warehouse.id,
          waiterId: user.id,
          guests: order.guests,
          openedAt,
          items: {
            create: order.lines.map(([name, quantity, kitchenStatus, note, modifiers = []]) => {
              const product = products.get(name)!;
              const chosen = modifiers.map(([group, option]) => ({
                group,
                name: option,
                price: groups.get(group)!.options.get(option)!.toFixed(2),
              }));
              const unitPrice = chosen.reduce((sum, m) => sum.plus(m.price), product.price);
              const sent = kitchenStatus !== "NEW";
              const ready = kitchenStatus === "READY" || kitchenStatus === "SERVED";
              return {
                productId: product.id,
                quantity,
                unitPrice,
                taxType: "EXCLUSIVE" as const,
                taxRate: "0",
                modifiers: chosen.length ? chosen : undefined,
                note: note ?? null,
                station: product.station ?? "KITCHEN",
                stationId: product.stationId ?? stationFor(product.station ?? "KITCHEN"),
                kitchenStatus,
                sentAt: sent ? sentAt : null,
                readyAt: ready ? minutesBefore(now, Math.max(order.minutesAgo - 14, 0)) : null,
              };
            }),
          },
        },
      });
      orders++;
    }
  }

  // Today's reservations, only into an empty Reservation table.
  let reservations = 0;
  if ((await prisma.reservation.count()) === 0) {
    const today = todayInAppZone(now);
    for (const [time, guestName, partySize, guestPhone, table, status] of RESERVATIONS) {
      await prisma.reservation.create({
        data: {
          tableId: tables.get(table)!,
          guestName,
          guestPhone,
          partySize,
          // Lagos is UTC+1 all year (no daylight saving).
          startsAt: new Date(`${today}T${time}:00+01:00`),
          status,
          createdById: user.id,
        },
      });
      reservations++;
    }
  }

  // Waste: its stock out of the warehouse with the entry, each in its own
  // transaction (retail's decreaseStock — never below zero); the voided one
  // put back and marked VOID, with its VOID entry.
  let waste = 0;
  if ((await prisma.wasteEntry.count()) === 0) {
    for (const w of WASTE) {
      const product = await prisma.product.findUniqueOrThrow({
        where: { id: products.get(w.item)!.id },
        select: { id: true, name: true, cost: true, unit: { select: { name: true } } },
      });
      const unitCost = new Prisma.Decimal(product.cost ?? 0);
      const lineCost = unitCost.times(w.qty).toDecimalPlaces(2);
      const entry = (minutesAgo: number) => ({
        warehouseId: warehouse.id,
        productId: product.id,
        qty: w.qty,
        unit: product.unit.name,
        reason: w.reason,
        note: w.note ?? null,
        costSnapshot: lineCost,
        loggedById: user.id,
        createdAt: minutesBefore(now, minutesAgo),
        lines: { create: [{ productId: product.id, qty: w.qty, unitCost, lineCost }] },
      });
      await prisma.$transaction(async (tx) => {
        const stockLine = { productId: product.id, warehouseId: warehouse.id, quantity: w.qty };
        await decreaseStock(tx, { ...stockLine, productName: product.name, warehouseName: warehouse.name });
        const logged = await tx.wasteEntry.create({ data: entry(w.minutesAgo), select: { id: true } });
        if (w.voided) {
          await increaseStock(tx, stockLine);
          await tx.wasteEntry.update({ where: { id: logged.id }, data: { status: "VOID", version: { increment: 1 } } });
          await tx.wasteEntry.create({ data: { ...entry(w.minutesAgo - 5), status: "VOID", voidOfId: logged.id, voidReason: w.voided } });
        }
      });
      waste++;
    }
  }

  console.log(
    `Menu: ${MENU.length} items (${newItems} new) · ingredients: ${INGREDIENTS.length} · areas: ${AREAS.length} · tables: ${tables.size}`,
  );
  console.log(`Waste: ${waste ? `${waste} entries added` : "skipped (waste already logged)"}`);
  console.log(
    `Orders: ${orders ? `${orders} added` : "skipped (orders already exist)"} · reservations: ${reservations ? `${reservations} added` : "skipped (reservations already exist)"}`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
