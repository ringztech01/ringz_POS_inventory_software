// Restaurant DEMO data — a full Nigerian menu to try every flow with: place
// orders as a waiter, send to the kitchen, merge tables, split bills, seat
// bookings and pay. Everything goes through the app's own rules:
//
//   menu        ~45 dishes and drinks (₦ prices), with modifier groups, on
//               the Kitchen or Bar station; recipes in WHOLE grams /
//               millilitres / pieces (so every bill can be settled), the
//               rest sold from their own stock
//   stock       one opening-stock Adjustment (ADJ_…) into the restaurant
//               warehouse — as if typed in on the Adjustments screen
//   floor       Garden Terrace (G1–G6), VIP Lounge (V1–V3), Bar Counter
//               (BC1–BC4); your own areas are left as they are
//   staff       kitchen@ / bar@ / waiter2@ / cashier@demo.test (password
//               Demo@2026) on the Kitchen, Bar, Waiter and a new Cashier role
//   activity    4 busy tables (opened, filled, sent and served through the
//               order services) and bookings for tonight and tomorrow
//
// Run (from the project folder):
//   npx tsx --tsconfig modules/restaurant/__tests__/tsconfig.dbtest.json modules/restaurant/demoSeed.ts
//   … --remove    takes the demo out again: menu, ingredients, groups,
//                 areas, staff and the Cashier role soft-deleted, open demo
//                 orders cancelled, bookings cancelled (sales stay as history)
//
// Safe to re-run: anything already there is left alone.
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { increaseStock } from "@/lib/stock";
import { generateReference } from "@/lib/reference";
import { todayInAppZone } from "@/lib/dateRanges";
import { RESTAURANT_PERMISSIONS as P } from "./manifest";
import { newQrToken } from "./lib/qrToken";
import { reservationSchema } from "./schemas/reservation";
import { cancelLineSchema, cancelOrderSchema } from "./schemas/orderFlow";
import { openTableOrder } from "./server/services/floor";
import { addLine } from "./server/services/orderLines";
import { changeOrderDetails } from "./server/services/orders";
import { cancelLine, cancelOrder, markLinesServed, sendToKitchen } from "./server/services/orderFlow";
import { advanceLine } from "./server/services/kitchen";
import { bookTable, cancelBooking } from "./server/services/reservations";

const DEMO_PASSWORD = "Demo@2026";
const STOCK_NOTE = "Restaurant demo — opening stock (modules/restaurant/demoSeed.ts)";
const BRAND = "House Kitchen";
const INGREDIENT_CATEGORY = "Kitchen Ingredients";

// ---- Ingredients: code, name, unit, cost per unit (₦), opening stock, alert
type U = "Gram" | "Milliliter" | "Pieces" | "Bottle";
const INGREDIENTS: [string, string, U, string, number, number][] = [
  ["DI-01", "Long-grain rice", "Gram", "1.80", 60000, 10000],
  ["DI-02", "Ofada rice", "Gram", "2.50", 20000, 4000],
  ["DI-03", "Chicken (quarter)", "Pieces", "1200.00", 150, 30],
  ["DI-04", "Turkey wing", "Pieces", "1500.00", 120, 25],
  ["DI-05", "Beef", "Gram", "6.50", 25000, 5000],
  ["DI-06", "Goat meat", "Gram", "8.00", 20000, 4000],
  ["DI-07", "Catfish (whole)", "Pieces", "3500.00", 60, 10],
  ["DI-08", "Snail", "Pieces", "600.00", 24, 30],
  ["DI-09", "Tomato stew base", "Milliliter", "1.20", 30000, 5000],
  ["DI-10", "Pepper sauce", "Milliliter", "1.50", 15000, 3000],
  ["DI-11", "Ayamase sauce", "Milliliter", "2.00", 10000, 2000],
  ["DI-12", "Egusi (ground melon)", "Gram", "4.00", 10000, 2000],
  ["DI-13", "Ogbono", "Gram", "5.00", 6000, 1000],
  ["DI-14", "Palm oil", "Milliliter", "1.80", 15000, 3000],
  ["DI-15", "Spinach (efo)", "Gram", "1.50", 8000, 1500],
  ["DI-16", "Plantain", "Pieces", "250.00", 300, 60],
  ["DI-17", "Yam", "Gram", "1.20", 20000, 4000],
  ["DI-18", "Pounded yam flour", "Gram", "2.20", 20000, 4000],
  ["DI-19", "Suya spice (yaji)", "Gram", "6.00", 3000, 500],
  ["DI-20", "Pepper soup spice", "Gram", "7.00", 2000, 400],
  ["DI-21", "Mixed vegetables", "Gram", "2.00", 8000, 1500],
  ["DI-22", "Spaghetti", "Gram", "1.60", 10000, 2000],
  ["DI-23", "Onions", "Pieces", "100.00", 300, 50],
  ["DI-24", "Soda mixer", "Milliliter", "0.80", 30000, 5000],
  ["DI-25", "Grenadine syrup", "Milliliter", "6.00", 3000, 500],
  ["DI-26", "Lime", "Pieces", "150.00", 200, 40],
  ["DI-27", "Zobo concentrate", "Milliliter", "1.00", 20000, 4000],
  ["DI-28", "Oranges", "Pieces", "120.00", 300, 60],
  ["DI-29", "Pineapple", "Gram", "0.80", 15000, 3000],
  ["DI-30", "Ginger", "Gram", "2.00", 2000, 300],
  ["DI-31", "Mint leaves", "Gram", "10.00", 80, 100],
  ["DI-32", "Sugar syrup", "Milliliter", "0.60", 5000, 1000],
  ["DI-33", "Red wine", "Milliliter", "12.00", 9000, 1500],
  ["DI-34", "White wine", "Milliliter", "12.00", 9000, 1500],
  ["DI-35", "Cognac", "Milliliter", "60.00", 3000, 500],
];

// ---- Modifier groups (min, max, [choice, extra ₦])
const GROUPS: { name: string; min: number; max: number; options: [string, string][] }[] = [
  { name: "Portion size", min: 1, max: 1, options: [["Regular", "0"], ["Large", "1500"]] },
  { name: "Choice of protein", min: 1, max: 1, options: [["Beef", "0"], ["Chicken", "500"], ["Goat meat", "1000"], ["Fish", "1500"], ["Assorted", "2000"]] },
  { name: "Swallow", min: 1, max: 1, options: [["Pounded yam", "0"], ["Eba", "0"], ["Amala", "0"], ["Semovita", "0"], ["Wheat", "300"]] },
  { name: "Spice level", min: 1, max: 1, options: [["Mild", "0"], ["Medium", "0"], ["Hot", "0"]] },
  { name: "Extras", min: 0, max: 3, options: [["Fried plantain", "800"], ["Coleslaw", "500"], ["Moi moi", "1000"], ["Extra chicken", "2000"]] },
  { name: "Serve", min: 1, max: 1, options: [["Chilled", "0"], ["With ice", "0"], ["Room temperature", "0"]] },
];

// ---- Menu: code, name, category, price ₦, station, groups, recipe, flags
type Item = { code: string; name: string; category: string; price: string; bar?: boolean; groups?: string[]; recipe?: [string, number][]; stock?: number; description?: string; unavailable?: boolean; hidden?: boolean };
const MENU: Item[] = [
  // Starters
  { code: "DM-101", name: "Peppered Snail", category: "Starters", price: "6500", groups: ["Spice level"], recipe: [["DI-08", 4], ["DI-10", 60]], description: "Jumbo snails tossed in hot pepper sauce." },
  { code: "DM-102", name: "Suya Skewers", category: "Starters", price: "4500", groups: ["Spice level"], recipe: [["DI-05", 200], ["DI-19", 10], ["DI-23", 1]], description: "Spiced beef on sticks with sliced onions." },
  { code: "DM-103", name: "Spring Rolls (4)", category: "Starters", price: "3000", stock: 120, description: "Crisp vegetable rolls with sweet chili dip." },
  { code: "DM-104", name: "Puff-Puff (6)", category: "Starters", price: "2000", stock: 120, description: "Warm, sugar-dusted dough balls." },
  { code: "DM-105", name: "Asun (Spicy Goat)", category: "Starters", price: "6000", groups: ["Spice level"], recipe: [["DI-06", 250], ["DI-10", 50], ["DI-23", 1]], description: "Smoky grilled goat in peppers and onions." },
  // Soups & swallow
  { code: "DM-201", name: "Egusi Soup", category: "Soups & Swallow", price: "5500", groups: ["Swallow", "Choice of protein"], recipe: [["DI-12", 80], ["DI-14", 40], ["DI-15", 50], ["DI-05", 120], ["DI-18", 150]], description: "Melon-seed soup with leafy greens, served with your swallow." },
  { code: "DM-202", name: "Efo Riro", category: "Soups & Swallow", price: "5500", groups: ["Swallow", "Choice of protein"], recipe: [["DI-15", 150], ["DI-14", 40], ["DI-10", 40], ["DI-05", 120], ["DI-18", 150]], description: "Rich spinach stew, Yoruba style." },
  { code: "DM-203", name: "Ogbono Soup", category: "Soups & Swallow", price: "5000", groups: ["Swallow", "Choice of protein"], recipe: [["DI-13", 70], ["DI-14", 40], ["DI-05", 120], ["DI-18", 150]], description: "Draw soup with wild mango seed." },
  { code: "DM-204", name: "Goat Meat Pepper Soup", category: "Soups & Swallow", price: "5000", groups: ["Spice level"], recipe: [["DI-06", 250], ["DI-20", 10]], description: "Light, fiery broth with tender goat." },
  { code: "DM-205", name: "Catfish Pepper Soup", category: "Soups & Swallow", price: "7500", groups: ["Spice level"], recipe: [["DI-07", 1], ["DI-20", 10]], description: "Fresh catfish in aromatic pepper soup." },
  { code: "DM-206", name: "Seafood Okra", category: "Soups & Swallow", price: "9000", groups: ["Swallow"], stock: 20, unavailable: true, description: "Sold out today." },
  // Rice & pasta
  { code: "DM-301", name: "Jollof Rice & Chicken", category: "Rice & Pasta", price: "4500", groups: ["Portion size", "Extras"], recipe: [["DI-01", 200], ["DI-09", 80], ["DI-03", 1]], description: "Smoky party jollof with grilled chicken." },
  { code: "DM-302", name: "Fried Rice & Turkey", category: "Rice & Pasta", price: "5500", groups: ["Portion size", "Extras"], recipe: [["DI-01", 200], ["DI-21", 60], ["DI-04", 1]], description: "Vegetable fried rice with peppered turkey wing." },
  { code: "DM-303", name: "Ofada Rice & Ayamase", category: "Rice & Pasta", price: "6000", groups: ["Portion size"], recipe: [["DI-02", 200], ["DI-11", 120], ["DI-05", 100]], description: "Local rice with green-pepper designer stew." },
  { code: "DM-304", name: "White Rice & Chicken Stew", category: "Rice & Pasta", price: "4000", groups: ["Portion size", "Extras"], recipe: [["DI-01", 200], ["DI-09", 100], ["DI-03", 1]] },
  { code: "DM-305", name: "Spaghetti Stir-Fry", category: "Rice & Pasta", price: "4000", groups: ["Choice of protein"], recipe: [["DI-22", 150], ["DI-21", 50], ["DI-09", 40]], description: "Wok-tossed spaghetti with vegetables." },
  // Grills
  { code: "DM-401", name: "Grilled Catfish", category: "Grills", price: "9500", groups: ["Spice level", "Extras"], recipe: [["DI-07", 1], ["DI-10", 60]], description: "Whole catfish, charcoal grilled, with pepper sauce." },
  { code: "DM-402", name: "Grilled Chicken (Half)", category: "Grills", price: "7000", groups: ["Spice level", "Extras"], recipe: [["DI-03", 2], ["DI-10", 30]] },
  { code: "DM-403", name: "Peppered Turkey Wings", category: "Grills", price: "6500", groups: ["Spice level"], recipe: [["DI-04", 2], ["DI-10", 50]] },
  { code: "DM-404", name: "Beef Suya Platter", category: "Grills", price: "8000", groups: ["Spice level"], recipe: [["DI-05", 350], ["DI-19", 15], ["DI-23", 1]], description: "A full platter of suya with onions and tomatoes." },
  { code: "DM-405", name: "Mixed Grill Platter (for 2)", category: "Grills", price: "18000", groups: ["Spice level", "Extras"], recipe: [["DI-03", 2], ["DI-05", 200], ["DI-04", 1], ["DI-07", 1], ["DI-10", 80]], description: "Chicken, suya, turkey and catfish to share." },
  // Sides
  { code: "DM-501", name: "Fried Plantain (Dodo)", category: "Sides", price: "1500", recipe: [["DI-16", 2]] },
  { code: "DM-502", name: "Moi Moi", category: "Sides", price: "1500", stock: 120 },
  { code: "DM-503", name: "Coleslaw", category: "Sides", price: "1000", stock: 120 },
  { code: "DM-504", name: "Yam Chips", category: "Sides", price: "2000", recipe: [["DI-17", 250]] },
  { code: "DM-505", name: "Extra Swallow", category: "Sides", price: "1000", groups: ["Swallow"], recipe: [["DI-18", 150]] },
  // Desserts
  { code: "DM-601", name: "Chin Chin Bowl", category: "Desserts", price: "1500", stock: 120 },
  { code: "DM-602", name: "Fruit Salad", category: "Desserts", price: "2500", stock: 60 },
  { code: "DM-603", name: "Vanilla Ice Cream", category: "Desserts", price: "2000", stock: 60 },
  // Soft drinks (Bar)
  { code: "DM-701", name: "Coca-Cola (50cl)", category: "Soft Drinks", price: "800", bar: true, groups: ["Serve"], stock: 240 },
  { code: "DM-702", name: "Fanta (50cl)", category: "Soft Drinks", price: "800", bar: true, groups: ["Serve"], stock: 240 },
  { code: "DM-703", name: "Sprite (50cl)", category: "Soft Drinks", price: "800", bar: true, groups: ["Serve"], stock: 240 },
  { code: "DM-704", name: "Malta Guinness", category: "Soft Drinks", price: "1000", bar: true, groups: ["Serve"], stock: 200 },
  { code: "DM-705", name: "Bottled Water (75cl)", category: "Soft Drinks", price: "500", bar: true, groups: ["Serve"], stock: 300 },
  { code: "DM-706", name: "Chi Exotic Juice (1L)", category: "Soft Drinks", price: "2500", bar: true, stock: 80 },
  // Mocktails & juices (Bar)
  { code: "DM-801", name: "Chapman", category: "Mocktails & Juices", price: "3000", bar: true, recipe: [["DI-24", 300], ["DI-25", 30], ["DI-26", 1]], description: "The classic — fizzy, fruity, a slice of lime." },
  { code: "DM-802", name: "Zobo", category: "Mocktails & Juices", price: "1500", bar: true, recipe: [["DI-27", 300]], description: "Chilled hibiscus with ginger and pineapple." },
  { code: "DM-803", name: "Fresh Orange Juice", category: "Mocktails & Juices", price: "2500", bar: true, recipe: [["DI-28", 4]] },
  { code: "DM-804", name: "Pineapple Ginger Smoothie", category: "Mocktails & Juices", price: "3000", bar: true, recipe: [["DI-29", 300], ["DI-30", 10]] },
  { code: "DM-805", name: "Virgin Mojito", category: "Mocktails & Juices", price: "3500", bar: true, recipe: [["DI-26", 1], ["DI-31", 5], ["DI-24", 250], ["DI-32", 30]] },
  // Beer (Bar)
  { code: "DM-901", name: "Star Lager", category: "Beer", price: "1500", bar: true, groups: ["Serve"], stock: 240 },
  { code: "DM-902", name: "Heineken", category: "Beer", price: "2000", bar: true, groups: ["Serve"], stock: 240 },
  { code: "DM-903", name: "Guinness Stout", category: "Beer", price: "2000", bar: true, groups: ["Serve"], stock: 200 },
  { code: "DM-904", name: "Trophy Lager", category: "Beer", price: "1300", bar: true, groups: ["Serve"], stock: 200 },
  // Wine & spirits (Bar)
  { code: "DM-951", name: "House Red Wine (glass)", category: "Wine & Spirits", price: "4500", bar: true, recipe: [["DI-33", 175]] },
  { code: "DM-952", name: "House White Wine (glass)", category: "Wine & Spirits", price: "4500", bar: true, recipe: [["DI-34", 175]] },
  { code: "DM-953", name: "Hennessy VS (shot)", category: "Wine & Spirits", price: "6000", bar: true, recipe: [["DI-35", 40]] },
  { code: "DM-954", name: "Smirnoff Ice", category: "Wine & Spirits", price: "2000", bar: true, groups: ["Serve"], stock: 120 },
  // Not on the guests' menu
  { code: "DM-990", name: "Staff Meal", category: "Rice & Pasta", price: "1000", recipe: [["DI-01", 150], ["DI-09", 50]], hidden: true },
];

const AREAS: [string, [string, number][]][] = [
  ["Garden Terrace", [["G1", 4], ["G2", 4], ["G3", 6], ["G4", 2], ["G5", 8], ["G6", 4]]],
  ["VIP Lounge", [["V1", 6], ["V2", 8], ["V3", 10]]],
  ["Bar Counter", [["BC1", 2], ["BC2", 2], ["BC3", 2], ["BC4", 2]]],
];

const STAFF: { email: string; first: string; last: string; role: string }[] = [
  { email: "kitchen@demo.test", first: "Kemi", last: "Kitchen", role: "Kitchen" },
  { email: "bar@demo.test", first: "Bayo", last: "Bar", role: "Bar" },
  { email: "waiter2@demo.test", first: "Tunde", last: "Waiter", role: "Waiter" },
  { email: "cashier@demo.test", first: "Ada", last: "Cashier", role: "Cashier" },
];
const CASHIER_PERMISSIONS = [P.SETTLE_BILL, P.MANAGE_ORDERS, P.MANAGE_RESERVATIONS, P.RESTAURANT_DASHBOARD, "Open Drawer", "Manage Pos Screen"];

// Busy tables: lines [item code, qty, [group, choice][], note?] and how far
// they've got. Placed through the order services, like a waiter would.
type Line = [string, number, [string, string][], string?];
const BUSY: { table: string; guests: number; stage: "not sent" | "in kitchen" | "partly ready" | "served"; lines: Line[] }[] = [
  { table: "G1", guests: 2, stage: "not sent", lines: [["DM-301", 2, [["Portion size", "Regular"]]], ["DM-801", 2, []]] },
  { table: "G3", guests: 5, stage: "in kitchen", lines: [["DM-201", 2, [["Swallow", "Pounded yam"], ["Choice of protein", "Goat meat"]]], ["DM-204", 1, [["Spice level", "Hot"]]], ["DM-302", 2, [["Portion size", "Large"]], "One without pepper"], ["DM-901", 3, [["Serve", "Chilled"]]], ["DM-802", 2, []]] },
  { table: "V1", guests: 6, stage: "partly ready", lines: [["DM-405", 1, [["Spice level", "Medium"]]], ["DM-404", 1, [["Spice level", "Hot"]]], ["DM-101", 1, [["Spice level", "Hot"]]], ["DM-952", 2, []], ["DM-902", 4, [["Serve", "Chilled"]]]] },
  { table: "BC2", guests: 2, stage: "served", lines: [["DM-102", 2, [["Spice level", "Medium"]]], ["DM-902", 2, [["Serve", "Chilled"]]]] },
];

// Bookings: day (0 today, 1 tomorrow), time, name, phone, party, table, note.
const BOOKINGS: [number, string, string, string, number, string, string?][] = [
  [0, "19:00", "Adebayo Johnson", "0803 456 7812", 4, "G2"],
  [0, "19:30", "Chiamaka Obi", "0812 334 9021", 6, "V2", "Anniversary — window side if possible"],
  [0, "20:00", "Musa Ibrahim", "0706 221 4580", 2, "G4"],
  [0, "20:30", "Funke Adeyemi", "0809 117 6633", 10, "V3", "Birthday — cake at 9pm"],
  [1, "13:00", "Emeka Nwosu", "0815 900 2244", 3, "G6"],
  [1, "19:00", "Tolu & Femi", "0802 765 1199", 2, "G4"],
];

// ---- Helpers ---------------------------------------------------------------

async function findOrCreate<T>(find: () => Promise<T | null>, create: () => Promise<T>): Promise<T> {
  return (await find()) ?? create();
}
const ok = <R extends { ok: boolean }>(label: string, result: R): R & { ok: true } => {
  if (!result.ok) throw new Error(`${label}: ${(result as { error?: string }).error ?? "refused"}`);
  return result as R & { ok: true };
};
const versionOf = async (orderId: string) => (await prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { version: true } })).version;

// ---- Seed --------------------------------------------------------------------

async function seed() {
  const setting = await prisma.businessSetting.findUnique({ where: { id: "default" } });
  if (!setting?.restaurantEnabled) throw new Error("The Restaurant module is off — switch it on in Settings first.");
  const warehouse = await prisma.warehouse.findFirst({ where: { id: setting.restaurantWarehouseId ?? undefined, deletedAt: null } });
  if (!warehouse) throw new Error("No restaurant warehouse is set (Settings › Restaurant).");
  const admin = await prisma.user.findFirst({ where: { deletedAt: null, userRole: { isSystem: true, deletedAt: null } }, orderBy: { createdAt: "asc" } });
  if (!admin) throw new Error("No administrator account found.");
  console.log(`Restaurant warehouse: ${warehouse.name} · stock adjustment by ${admin.firstName} ${admin.lastName}`);

  const stations = new Map((await prisma.kitchenStation.findMany({ where: { deletedAt: null } })).map((s) => [s.code, s.id]));
  const kitchen = stations.get("KIT") ?? null;
  const bar = stations.get("BAR") ?? kitchen;
  const brand = await findOrCreate(() => prisma.brand.findFirst({ where: { name: BRAND, deletedAt: null } }), () => prisma.brand.create({ data: { name: BRAND } }));
  const categoryIds = new Map<string, string>();
  for (const name of [INGREDIENT_CATEGORY, ...new Set(MENU.map((m) => m.category))]) {
    const c = await findOrCreate(() => prisma.category.findFirst({ where: { name, deletedAt: null } }), () => prisma.category.create({ data: { name } }));
    categoryIds.set(name, c.id);
  }
  const unitIds = new Map<string, string>();
  for (const name of ["Gram", "Milliliter", "Pieces", "Bottle"] as const) {
    const u = await findOrCreate(() => prisma.unit.findFirst({ where: { name, deletedAt: null }, orderBy: { createdAt: "asc" } }), () => prisma.unit.create({ data: { name } }));
    unitIds.set(name, u.id);
  }

  // Ingredients.
  const ids = new Map<string, string>();
  const opening: { productId: string; quantity: number }[] = [];
  let newProducts = 0;
  for (const [code, name, unit, cost, stock, alert] of INGREDIENTS) {
    const existing = await prisma.product.findUnique({ where: { code } });
    const product = existing ?? (await prisma.product.create({ data: { code, name, price: "0", cost, stockAlert: alert, taxType: "EXCLUSIVE", productType: "INGREDIENT", categoryId: categoryIds.get(INGREDIENT_CATEGORY)!, brandId: brand.id, unitId: unitIds.get(unit)! } }));
    if (!existing) {
      newProducts++;
      opening.push({ productId: product.id, quantity: stock });
    }
    ids.set(code, product.id);
  }

  // Modifier groups.
  const groups = new Map<string, { id: string; options: Map<string, string> }>();
  for (const [i, g] of GROUPS.entries()) {
    const row = await findOrCreate(
      () => prisma.modifierGroup.findFirst({ where: { name: g.name, deletedAt: null }, include: { modifiers: { where: { deletedAt: null } } } }),
      () =>
        prisma.modifierGroup.create({
          data: { name: g.name, minSelect: g.min, maxSelect: g.max, sortOrder: i, modifiers: { create: g.options.map(([name, price], order) => ({ name, price, sortOrder: order })) } },
          include: { modifiers: { where: { deletedAt: null } } },
        }),
    );
    groups.set(g.name, { id: row.id, options: new Map(row.modifiers.map((m) => [m.name, m.id])) });
  }

  // Menu items (with their groups and recipes when new).
  for (const item of MENU) {
    const existing = await prisma.product.findUnique({ where: { code: item.code } });
    if (existing) {
      ids.set(item.code, existing.id);
      continue;
    }
    const product = await prisma.product.create({
      data: {
        code: item.code,
        name: item.name,
        price: item.price,
        taxType: "EXCLUSIVE",
        productType: "MENU_ITEM",
        showOnMenu: !item.hidden,
        isAvailable: !item.unavailable,
        prepStation: item.bar ? "BAR" : "KITCHEN",
        stationId: item.bar ? bar : kitchen,
        menuDescription: item.description ?? null,
        categoryId: categoryIds.get(item.category)!,
        brandId: brand.id,
        unitId: unitIds.get(item.stock && item.bar ? "Bottle" : "Pieces")!,
        modifierGroups: { connect: (item.groups ?? []).map((name) => ({ id: groups.get(name)!.id })) },
        recipeLines: { create: (item.recipe ?? []).map(([code, quantity]) => ({ ingredientId: ids.get(code)!, quantity })) },
      },
    });
    newProducts++;
    ids.set(item.code, product.id);
    if (item.stock) opening.push({ productId: product.id, quantity: item.stock });
  }

  // Opening stock: one Adjustment, like the Adjustments screen's.
  if (opening.length) {
    await prisma.$transaction(async (tx) => {
      await tx.adjustment.create({
        data: { reference: generateReference("ADJ"), warehouseId: warehouse.id, date: new Date(), notes: STOCK_NOTE, createdById: admin.id, items: { create: opening.map((o) => ({ ...o, type: "ADDITION" as const })) } },
      });
      for (const o of opening) await increaseStock(tx, { productId: o.productId, warehouseId: warehouse.id, quantity: o.quantity });
    });
  }

  // Areas and tables.
  const tables = new Map<string, string>();
  const lastSort = (await prisma.diningArea.aggregate({ _max: { sortOrder: true }, where: { deletedAt: null } }))._max.sortOrder ?? 0;
  for (const [i, [areaName, rows]] of AREAS.entries()) {
    const area = await findOrCreate(
      () => prisma.diningArea.findFirst({ where: { name: areaName, warehouseId: warehouse.id, deletedAt: null } }),
      () => prisma.diningArea.create({ data: { name: areaName, warehouseId: warehouse.id, sortOrder: lastSort + 1 + i } }),
    );
    for (const [name, seats] of rows) {
      const table = await findOrCreate(() => prisma.table.findFirst({ where: { name, areaId: area.id, deletedAt: null } }), () => prisma.table.create({ data: { name, seats, areaId: area.id, qrToken: newQrToken() } }));
      tables.set(name, table.id);
    }
  }

  // Staff, and the Cashier role.
  const cashierRole = await findOrCreate(
    () => prisma.role.findFirst({ where: { name: "Cashier", deletedAt: null } }),
    () => prisma.role.create({ data: { name: "Cashier", permissions: { create: CASHIER_PERMISSIONS.map((permission) => ({ permission })) } } }),
  );
  const password = await bcrypt.hash(DEMO_PASSWORD, 10);
  const staff = new Map<string, string>();
  for (const s of STAFF) {
    const role = s.role === "Cashier" ? cashierRole : await prisma.role.findFirst({ where: { name: s.role, deletedAt: null } });
    if (!role) throw new Error(`No "${s.role}" role.`);
    const user = await findOrCreate(
      () => prisma.user.findFirst({ where: { email: s.email } }),
      () => prisma.user.create({ data: { email: s.email, firstName: s.first, lastName: s.last, password, roleId: role.id } }),
    );
    staff.set(s.email, user.id);
  }
  const waiter = staff.get("waiter2@demo.test")!;

  // Busy tables — on the first run only (never on top of your own testing:
  // once any demo table has had an order, none are added).
  let busy = 0;
  const demoTablesUsed = (await prisma.order.count({ where: { tableId: { in: [...tables.values()] } } })) > 0;
  for (const b of demoTablesUsed ? [] : BUSY) {
    const tableId = tables.get(b.table)!;
    const opened = ok(`open ${b.table}`, await openTableOrder(tableId, waiter));
    const orderId = opened.orderId;
    ok(`guests ${b.table}`, await changeOrderDetails(orderId, await versionOf(orderId), { field: "guests", value: b.guests }));
    for (const [code, qty, choices, note] of b.lines) {
      const modifierIds = choices.map(([g, c]) => groups.get(g)!.options.get(c)!);
      for (let n = 0; n < qty; n++) {
        ok(`add ${code}`, await addLine({ orderId, version: await versionOf(orderId), productId: ids.get(code)!, modifierIds, note: n === 0 ? (note ?? null) : null }));
      }
    }
    if (b.stage !== "not sent") {
      ok(`send ${b.table}`, await sendToKitchen(orderId, await versionOf(orderId), waiter));
      const lines = await prisma.orderItem.findMany({ where: { orderId, deletedAt: null, cancelledAt: null }, select: { id: true, station: true } });
      const advance = async (id: string, steps: ("PENDING" | "PREPARING")[]) => {
        for (const from of steps) ok("kitchen", await advanceLine(id, from));
      };
      if (b.stage === "in kitchen") for (const [i, l] of lines.entries()) if (i % 2 === 0) await advance(l.id, ["PENDING"]);
      if (b.stage === "partly ready") for (const l of lines) await advance(l.id, l.station === "BAR" ? ["PENDING", "PREPARING"] : ["PENDING"]);
      if (b.stage === "served") {
        for (const l of lines) await advance(l.id, ["PENDING", "PREPARING"]);
        ok(`serve ${b.table}`, await markLinesServed(orderId, await versionOf(orderId), lines.map((l) => l.id)));
      }
    }
    busy++;
  }

  // Bookings — only where that table has none booked that day.
  let booked = 0;
  const today = todayInAppZone();
  const dayOf = (offset: number) => {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  };
  for (const [day, time, guestName, guestPhone, partySize, table, notes] of BOOKINGS) {
    const date = dayOf(day);
    const start = new Date(`${date}T${time}:00+01:00`);
    if (start.getTime() < Date.now()) continue;
    const tableId = tables.get(table)!;
    const exists = await prisma.reservation.count({ where: { tableId, deletedAt: null, status: "BOOKED", startsAt: { gte: new Date(`${date}T00:00:00+01:00`), lt: new Date(`${date}T23:59:59+01:00`) } } });
    if (exists) continue;
    const input = reservationSchema.parse({ guestName, guestPhone, partySize, date, time, tableId, ...(notes ? { notes } : {}) });
    ok(`book ${guestName}`, await bookTable(input, admin.id));
    booked++;
  }

  console.log(`Products: ${INGREDIENTS.length} ingredients + ${MENU.length} menu items (${newProducts} new) · stock: ${opening.length ? `${opening.length} lines on an opening Adjustment` : "already there"}`);
  console.log(`Floor: ${tables.size} demo tables in ${AREAS.length} areas · busy tables: ${busy} added · bookings: ${booked} added`);
  console.log(`Staff (password ${DEMO_PASSWORD}): ${STAFF.map((s) => `${s.email} (${s.role})`).join(", ")}`);
}

// ---- Remove --------------------------------------------------------------------

async function remove() {
  const now = new Date();
  const areaNames = AREAS.map(([name]) => name);
  const tables = await prisma.table.findMany({ where: { deletedAt: null, area: { name: { in: areaNames }, deletedAt: null } }, select: { id: true } });
  const tableIds = tables.map((t) => t.id);
  let cancelled = 0;
  const admin = await prisma.user.findFirst({ where: { deletedAt: null, userRole: { isSystem: true, deletedAt: null } }, orderBy: { createdAt: "asc" } });
  if (!admin) throw new Error("No administrator account found.");
  for (const order of await prisma.order.findMany({ where: { tableId: { in: tableIds }, status: { notIn: ["BILLED", "CANCELLED"] } }, select: { id: true } })) {
    // Lines already sent are voided first (a VOID ticket each), as on screen;
    // then the order is cancelled. An order with a part paid is left alone.
    const sent = await prisma.orderItem.findMany({ where: { orderId: order.id, deletedAt: null, cancelledAt: null, kitchenStatus: { not: "NEW" } }, select: { id: true } });
    for (const line of sent) {
      await cancelLine(cancelLineSchema.parse({ orderId: order.id, version: await versionOf(order.id), lineId: line.id, reason: "OTHER", details: "Demo data removed" }), admin.id);
    }
    const r = await cancelOrder(cancelOrderSchema.parse({ orderId: order.id, version: await versionOf(order.id), reason: "OTHER", details: "Demo data removed" }));
    if (r.ok) cancelled++;
    else console.log(`  couldn't cancel an open demo order (${r.error}) — finish or cancel it on screen, then run --remove again.`);
  }
  for (const r of await prisma.reservation.findMany({ where: { tableId: { in: tableIds }, status: "BOOKED", deletedAt: null }, select: { id: true } })) await cancelBooking(r.id);
  const codes = [...INGREDIENTS.map(([code]) => code), ...MENU.map((m) => m.code)];
  await prisma.$transaction(async (tx) => {
    await tx.product.updateMany({ where: { code: { in: codes }, deletedAt: null }, data: { deletedAt: now } });
    await tx.modifierGroup.updateMany({ where: { name: { in: GROUPS.map((g) => g.name) }, deletedAt: null }, data: { deletedAt: now } });
    await tx.table.updateMany({ where: { id: { in: tableIds } }, data: { deletedAt: now } });
    await tx.diningArea.updateMany({ where: { name: { in: areaNames }, deletedAt: null }, data: { deletedAt: now } });
    await tx.user.updateMany({ where: { email: { in: STAFF.map((s) => s.email) }, deletedAt: null }, data: { deletedAt: now } });
    await tx.role.updateMany({ where: { name: "Cashier", deletedAt: null, users: { none: { deletedAt: null } } }, data: { deletedAt: now } });
  });
  console.log(`Removed the demo: menu, ingredients, groups, ${tableIds.length} tables, staff (${cancelled} open orders cancelled; sales and stock history kept).`);
}

(process.argv.includes("--remove") ? remove() : seed())
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
