// Run with: npx tsx --test modules/restaurant/__tests__/publicMenu.test.ts
// Part 8 Step 3: the guest menu's pure rules.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildPosMenu, type MenuDishRow, type MenuGroupRow } from "../lib/posMenu";
import { menuAvailability } from "../lib/menuAvailability";
import { MENU_STRINGS } from "../lib/menuStrings";
import { formatNaira } from "@/lib/format";
import {
  addsTax,
  allergensOf,
  formatMenuPrice,
  isGuestMenuPath,
  looksLikeToken,
  matchesSearch,
  menuSections,
  photoUrls,
  priceNotes,
  shownOnMenu,
  spinReady,
  statusOf,
} from "../lib/publicMenu";

describe("states and prices", () => {
  test("the POS's rule, in the guest's words: switched off wins; out of stock is Sold out", () => {
    const state = (isAvailable: boolean, recipe: { quantity: string; stock: string }[], ownStock: string) => statusOf(menuAvailability({ isAvailable, recipe, ownStock }));
    assert.equal(state(false, [], "10"), "unavailable", "isAvailable off → Currently unavailable");
    assert.equal(state(false, [{ quantity: "1", stock: "0" }], "0"), "unavailable", "off wins over out of stock");
    assert.equal(state(true, [], "0"), "sold_out", "no recipe, zero stock");
    assert.equal(state(true, [], "3"), "available");
    assert.equal(state(true, [{ quantity: "2", stock: "5" }, { quantity: "1", stock: "0" }], "0"), "sold_out", "a recipe ingredient at zero");
    assert.equal(state(true, [{ quantity: "0.25", stock: "0.25" }], "0"), "available", "an ingredient that covers one serving");
    assert.equal(MENU_STRINGS.soldOut, "Sold out");
    assert.equal(MENU_STRINGS.unavailable, "Currently unavailable");
  });

  test("sold out: greyed, or hidden when the menu hides it; unavailable always shows", () => {
    assert.deepEqual([shownOnMenu("sold_out", true), shownOnMenu("sold_out", false), shownOnMenu("unavailable", false), shownOnMenu("available", false)], [true, false, true, true]);
  });

  test("a price reads as on the POS (₦), or with the code", () => {
    for (const price of ["1500", "18.5", "0.99", "1234567.8"]) assert.equal(formatMenuPrice(price, "SYMBOL"), formatNaira(price), price);
    assert.equal(formatMenuPrice("1500", "CODE"), "NGN 1,500.00");
  });

  test("the header's small print: tax included or added; the service charge when there is one", () => {
    assert.deepEqual(priceNotes({ anyTaxAdded: false, servicePercent: "10.00" }), ["Prices include tax", "10% service charge added to the bill"]);
    assert.deepEqual(priceNotes({ anyTaxAdded: true, servicePercent: "12.50" }), ["Tax is added to the bill", "12.5% service charge added to the bill"]);
    assert.deepEqual(priceNotes({ anyTaxAdded: false, servicePercent: "0" }), ["Prices include tax"]);
    assert.deepEqual(priceNotes({ anyTaxAdded: false, servicePercent: null }), ["Prices include tax"]);
    assert.deepEqual([addsTax({ taxType: "EXCLUSIVE", orderTax: "7.5" }), addsTax({ taxType: "EXCLUSIVE", orderTax: "0" }), addsTax({ taxType: "INCLUSIVE", orderTax: "7.5" }), addsTax({ taxType: "EXCLUSIVE", orderTax: null })], [true, false, false, false]);
  });
});

describe("what an item shows", () => {
  test("allergens: short trimmed names only, no repeats", () => {
    assert.deepEqual(allergensOf([" Peanuts ", "Gluten", "Gluten", 4, null, "", "x".repeat(60)]), ["Peanuts", "Gluten", "x".repeat(40)]);
    assert.deepEqual(allergensOf("Peanuts"), []);
    assert.deepEqual(allergensOf(null), []);
  });

  test("360° only with a full set of frames (24–36)", () => {
    const frames = (n: number) => Array.from({ length: n }, (_, i) => `menu/p/spin-${i}.webp`);
    assert.deepEqual([spinReady(frames(24)), spinReady(frames(36)), spinReady(frames(23)), spinReady(frames(37)), spinReady([]), spinReady(null), spinReady([...frames(23), 5])], [true, true, false, false, false, false, false]);
  });

  test("photo URLs: under /menu/media/<item>/, a -1200 photo's -400 thumbnail; anything odd gives none", () => {
    assert.deepEqual(photoUrls("cmabc123", "menu/cmabc123/photo-1200.webp"), { full: "/menu/media/cmabc123/photo-1200.webp", thumb: "/menu/media/cmabc123/photo-400.webp" });
    assert.deepEqual(photoUrls("cmabc123", "menu/cmabc123/dish.jpg"), { full: "/menu/media/cmabc123/dish.jpg", thumb: "/menu/media/cmabc123/dish.jpg" });
    assert.equal(photoUrls("cmabc123", null), null);
    assert.equal(photoUrls("cmabc123", "menu/cmabc123/../../.env"), null);
    assert.equal(photoUrls("cmabc123", "menu/cmabc123/photo.svg"), null, "only WebP, JPEG, PNG");
    assert.equal(photoUrls("../x", "menu/x/photo.webp"), null);
  });

  test("search on the phone: every word, in the name or the description, any case", () => {
    const item = { name: "Jollof Rice & Chicken", description: "Smoky party jollof with grilled chicken thigh" };
    assert.deepEqual(["jollof", "SMOKY chicken", "thigh rice", "", "  ", "fish"].map((q) => matchesSearch(item, q)), [true, true, true, true, true, false]);
    assert.equal(matchesSearch({ name: "Zobo", description: null }, "hibiscus"), false);
  });

  test("tokens and paths", () => {
    assert.deepEqual(["AbC_-1234567890123456789", "short", "has space in it 12345678", "x".repeat(65), "../../etc/passwd"].map(looksLikeToken), [true, false, false, false, false]);
    assert.deepEqual(["/menu", "/menu/abc", "/menu/media/x/y.webp", "/menus", "/restaurant/menu", "/menu-cards"].map(isGuestMenuPath), [true, true, true, false, false, false]);
  });
});

describe("sections, in the POS's order", () => {
  const group = (id: string, name: string, department: "FOOD" | "BAR", rank: number, parentId: string | null = null): MenuGroupRow => ({ id, name, parentId, department, colour: null, rank, gridPosition: null });
  const dish = (id: string, groupId: string | null, categoryName = "Mains", stationDepartment: "FOOD" | "BAR" = "FOOD"): MenuDishRow => ({ id, name: id, categoryId: `cat-${categoryName}`, categoryName, groupId, gridPosition: null, stationDepartment });

  test("groups by rank, a sub-group folded into its top group, then categories for dishes not in a group", () => {
    const tree = buildPosMenu(
      [group("g-mains", "Mains", "FOOD", 2), group("g-start", "Starters", "FOOD", 1), group("g-grill", "Grill", "FOOD", 1, "g-mains"), group("g-drinks", "Drinks", "BAR", 1)],
      [dish("tilapia", "g-mains"), dish("suya", "g-grill"), dish("rolls", "g-start"), dish("zobo", "g-drinks"), dish("puff", null, "Sides"), dish("chapman", null, "Cocktails", "BAR")],
    );
    const { sections, order, sectionOf } = menuSections(tree, new Set(["tilapia", "suya", "rolls", "zobo", "puff", "chapman"]));
    assert.deepEqual(sections.map((s) => [s.name, s.department]), [["Starters", "FOOD"], ["Mains", "FOOD"], ["Sides", "FOOD"], ["Drinks", "BAR"], ["Cocktails", "BAR"]]);
    assert.deepEqual(order, ["rolls", "suya", "tilapia", "puff", "zobo", "chapman"], "the sub-group's dishes in the Mains section (its grid: sub-groups first)");
    assert.equal(sectionOf.suya, "g-mains");
  });

  test("only listed dishes; a section with none isn't shown", () => {
    const tree = buildPosMenu([group("g-start", "Starters", "FOOD", 1), group("g-mains", "Mains", "FOOD", 2)], [dish("rolls", "g-start"), dish("tilapia", "g-mains")]);
    const { sections, order } = menuSections(tree, new Set(["tilapia"]));
    assert.deepEqual([sections.map((s) => s.name), order], [["Mains"], ["tilapia"]]);
  });
});

describe("the words", () => {
  test("a dead code's message, as the spec words it", () => {
    assert.equal(`${MENU_STRINGS.inactiveTitle} ${MENU_STRINGS.inactiveBody}`, "This QR code is no longer active. Please ask your waiter.");
    assert.equal(MENU_STRINGS.table("12"), "Table 12");
  });
});

describe("the public routes, read from the source", () => {
  const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

  test("the proxy lets /menu through before any sign-in check, and marks it", () => {
    const proxy = read("proxy.ts");
    const pass = proxy.indexOf("if (isGuestMenuPath(pathname))");
    assert.ok(pass > 0 && pass < proxy.indexOf("if (!req.auth && !isPublicPath(pathname))"), "before the sign-in redirect");
    assert.match(proxy, /headers\.delete\(GUEST_SURFACE_HEADER\)/, "a header sent from outside is dropped");
  });

  test("the guest menu's shell loads nothing from the internet (no web fonts), and no toasts", () => {
    const layout = read("app/layout.tsx");
    const guest = layout.slice(layout.indexOf('=== "menu"'), layout.indexOf("return (", layout.indexOf('=== "menu"') + 200));
    assert.ok(guest.length > 0);
    assert.doesNotMatch(guest, /googleapis|gstatic|<link|AppToaster/);
  });

  test("every /menu route hands to a module that checks the Restaurant module first", () => {
    const routes = {
      "app/(menu)/menu/[qrToken]/page.tsx": "modules/restaurant/pages/PublicMenuPage.tsx",
      "app/(menu)/menu/[qrToken]/status/route.ts": "modules/restaurant/server/routes/menuStatus.ts",
      "app/(menu)/menu/media/[...path]/route.ts": "modules/restaurant/server/routes/menuMedia.ts",
    };
    for (const [route, target] of Object.entries(routes)) assert.match(read(route), new RegExp(target.replace(/\.tsx?$/, "").replace("modules/", "@/modules/")), route);
    assert.match(read("modules/restaurant/pages/PublicMenuPage.tsx"), /if \(page\.kind === "off"\) notFound\(\);/);
    const queries = read("modules/restaurant/server/queries/publicMenu.ts");
    assert.equal(queries.match(/if \(!\(await isModuleEnabled\(restaurantModule\.id\)\)\)/g)?.length, 2, "the page's data and the live check");
    assert.match(read("modules/restaurant/server/routes/menuMedia.ts"), /if \(!\(await isModuleEnabled\(restaurantModule\.id\)\)\) return NOT_FOUND\(\);/);
  });

  test("no `any` in the guest menu's code", () => {
    const files = ["lib/publicMenu.ts", "lib/menuStrings.ts", "server/queries/publicMenu.ts", "server/routes/menuStatus.ts", "server/routes/menuMedia.ts", "pages/PublicMenuPage.tsx", "components/publicMenu/PublicMenu.tsx"].map((f) => `modules/restaurant/${f}`);
    assert.deepEqual(files.filter((f) => /(:\s*any\b|\bas any\b|<any>|any\[\])/.test(read(f))), []);
  });
});
