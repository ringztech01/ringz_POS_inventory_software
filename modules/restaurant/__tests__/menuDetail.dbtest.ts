// Part 8 Step 4 against a real database (a throwaway copy): what an item's
// detail gets with the menu — its option groups exactly as the POS shows
// them (prices following the menu's settings), and its chosen media only —
// and the files behind it: 3D models from the item's folder, the viewer's
// decoders from this server. Module off: 404. Needs:
//
//   RESTAURANT_DB_TEST=1 DATABASE_URL=mysql://…/<name>_restaurant_check \
//     npx tsx --tsconfig modules/restaurant/__tests__/tsconfig.dbtest.json \
//       --test modules/restaurant/__tests__/menuDetail.dbtest.ts
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm, rmdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import { newQrToken } from "../lib/qrToken";
import { loadPublicMenu, type PublicMenuPage } from "../server/queries/publicMenu";
import { getModifierGroupsFor } from "../server/queries/modifiers";
import { GET as mediaRoute } from "../server/routes/menuMedia";
import { GET as viewerRoute } from "../server/routes/menuViewer";

const database = new URL(process.env.DATABASE_URL ?? "mysql://x/none").pathname.slice(1);
const enabled = process.env.RESTAURANT_DB_TEST === "1" && database.endsWith("_restaurant_check");
const skip = enabled ? false : "set RESTAURANT_DB_TEST=1 and use a *_restaurant_check database";

const id: Record<"spin" | "model" | "photoOnly", string> = { spin: "", model: "", photoOnly: "" };
let token = "";
const dirs: string[] = [];
const before0 = { showPrices: true, currencyDisplay: "SYMBOL" as "SYMBOL" | "CODE" };

const menu = async () => {
  const page: PublicMenuPage = await loadPublicMenu(token);
  assert.equal(page.kind, "menu");
  return page as Extract<PublicMenuPage, { kind: "menu" }>;
};
const item = async (key: keyof typeof id) => (await menu()).items.find((i) => i.id === id[key])!;
const frames = (pid: string) => Array.from({ length: 24 }, (_, i) => `menu/${pid}/spin-${String(i).padStart(2, "0")}.webp`);

describe("The item detail's data (database copy)", { skip }, () => {
  let moduleWas = true;
  before(async () => {
    moduleWas = (await prisma.businessSetting.findUniqueOrThrow({ where: { id: "default" }, select: { restaurantEnabled: true } })).restaurantEnabled;
    await prisma.businessSetting.update({ where: { id: "default" }, data: { restaurantEnabled: true } });
    const s = await prisma.menuSettings.findFirstOrThrow();
    Object.assign(before0, { showPrices: s.showPrices, currencyDisplay: s.currencyDisplay });
    await prisma.menuSettings.update({ where: { id: s.id }, data: { showPrices: true, currencyDisplay: "SYMBOL", menuEnabled: true, showSoldOut: true } });
    const warehouseId = (await prisma.warehouse.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    const areaId = (await prisma.diningArea.create({ data: { name: "Detail check", warehouseId }, select: { id: true } })).id;
    token = newQrToken();
    await prisma.table.create({ data: { name: `DT${Date.now() % 100000}`, seats: 2, areaId, qrToken: token } });
    const brandId = (await prisma.brand.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    const unitId = (await prisma.unit.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    const categoryId = (await prisma.category.create({ data: { name: "Detail check" }, select: { id: true } })).id;
    const make = async (name: string, extra: object) => {
      const p = await prisma.product.create({ data: { name, code: `DT-${name}-${Date.now()}`, price: "2500", orderTax: "0", categoryId, brandId, unitId, taxType: "EXCLUSIVE", productType: "MENU_ITEM", showOnMenu: true, ...extra }, select: { id: true } });
      await prisma.productStock.create({ data: { productId: p.id, warehouseId, quantity: 9 } });
      return p.id;
    };
    id.spin = await make("DT Spin dish", { mediaType: "SPIN" });
    id.model = await make("DT Model dish", { mediaType: "MODEL" });
    id.photoOnly = await make("DT Photo dish", { mediaType: "PHOTO" });
    await prisma.product.update({ where: { id: id.spin }, data: { spinFrames: frames(id.spin), photoPath: `menu/${id.spin}/photo-1200.webp` } });
    await prisma.product.update({ where: { id: id.model }, data: { modelGlbPath: `menu/${id.model}/model.glb`, modelUsdzPath: `menu/${id.model}/model.usdz`, photoPath: `menu/${id.model}/photo-1200.webp` } });
    // Frames and a model on the photo dish too: it still shows its photo.
    await prisma.product.update({ where: { id: id.photoOnly }, data: { spinFrames: frames(id.photoOnly), modelGlbPath: `menu/${id.photoOnly}/model.glb` } });
    // Options: a required pick and an optional extra.
    await prisma.modifierGroup.create({
      data: { name: "DT Portion", minSelect: 1, maxSelect: 1, products: { connect: [{ id: id.spin }] }, modifiers: { create: [{ name: "Regular", price: "0", sortOrder: 1 }, { name: "Large", price: "500", sortOrder: 2 }] } },
    });
    await prisma.modifierGroup.create({
      data: { name: "DT Extras", minSelect: 0, maxSelect: 2, products: { connect: [{ id: id.spin }] }, modifiers: { create: [{ name: "Plantain", price: "300", sortOrder: 1 }, { name: "Egg", price: "250", sortOrder: 2, deletedAt: new Date() }] } },
    });
    // The model's files.
    const dir = path.join(process.cwd(), "uploads", "menu", id.model);
    dirs.push(dir);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "model.glb"), Buffer.from("glTF\u0002\u0000\u0000\u0000test"));
    await writeFile(path.join(dir, "model.usdz"), Buffer.from("PK\u0003\u0004test"));
  });
  after(async () => {
    await prisma.menuSettings.updateMany({ data: before0 });
    await prisma.businessSetting.update({ where: { id: "default" }, data: { restaurantEnabled: moduleWas } });
    for (const dir of dirs) await rm(dir, { recursive: true, force: true });
    await rmdir(path.join(process.cwd(), "uploads", "menu")).catch(() => undefined);
  });

  test("options: the groups and options the POS shows, in its order, with its prices; removed options left out", async () => {
    const detail = await item("spin");
    const pos = (await getModifierGroupsFor([id.spin]))[id.spin];
    assert.deepEqual(
      detail.modifiers.map((g) => [g.name, g.rule, g.options.map((o) => [o.name, o.price])]),
      pos.map((g) => [g.name, g.rule, g.options.map((o) => [o.name, o.price])]),
    );
    const portion = detail.modifiers.find((g) => g.name === "DT Portion")!;
    assert.deepEqual(portion.options.map((o) => [o.name, o.price]), [["Regular", ""], ["Large", "+₦500.00"]]);
    assert.deepEqual(detail.modifiers.find((g) => g.name === "DT Extras")!.options.map((o) => o.name), ["Plantain"], "the removed Egg isn't there");
    assert.deepEqual((await item("photoOnly")).modifiers, [], "no options: none");
  });

  test("options follow the menu's prices: NGN, or hidden", async () => {
    await prisma.menuSettings.updateMany({ data: { currencyDisplay: "CODE" } });
    assert.equal((await item("spin")).modifiers.find((g) => g.name === "DT Portion")!.options[1].price, "+NGN 500.00");
    await prisma.menuSettings.updateMany({ data: { currencyDisplay: "SYMBOL", showPrices: false } });
    const hidden = await item("spin");
    assert.ok(hidden.modifiers.every((g) => g.options.every((o) => o.price === "")) && hidden.price === null);
    await prisma.menuSettings.updateMany({ data: { showPrices: true } });
  });

  test("media: the chosen type only — 360° frames in order; the 3D model's GLB and USDZ; a photo item shows its photo", async () => {
    const spin = await item("spin");
    assert.deepEqual([spin.spin, spin.model, spin.spinFrames?.length, spin.spinFrames?.[0], spin.modelFiles], [true, false, 24, `/menu/media/${id.spin}/spin-00.webp`, null]);
    const model = await item("model");
    assert.deepEqual([model.spin, model.model, model.spinFrames, model.modelFiles], [false, true, null, { glb: `/menu/media/${id.model}/model.glb`, usdz: `/menu/media/${id.model}/model.usdz` }]);
    const photo = await item("photoOnly");
    assert.deepEqual([photo.spin, photo.model, photo.spinFrames, photo.modelFiles], [false, false, null, null]);
  });

  test("the model's files: served with their types; a listed item's folder only", async () => {
    const get = (parts: string[]) => mediaRoute(new Request("http://localhost/x"), { params: Promise.resolve({ path: parts }) });
    const glb = await get([id.model, "model.glb"]);
    assert.deepEqual([glb.status, glb.headers.get("content-type")], [200, "model/gltf-binary"]);
    const usdz = await get([id.model, "model.usdz"]);
    assert.deepEqual([usdz.status, usdz.headers.get("content-type")], [200, "model/vnd.usdz+zip"]);
    assert.equal((await get([id.model, "model.obj"])).status, 404);
    await prisma.product.update({ where: { id: id.model }, data: { showOnMenu: false } });
    assert.equal((await get([id.model, "model.glb"])).status, 404, "off the menu: not served");
    await prisma.product.update({ where: { id: id.model }, data: { showOnMenu: true } });
  });

  test("the 3D viewer and its decoders: from this server, those files only", async () => {
    const get = (parts: string[]) => viewerRoute(new Request("http://localhost/x"), { params: Promise.resolve({ path: parts }) });
    const viewer = await get(["model-viewer.min.js"]);
    assert.deepEqual([viewer.status, viewer.headers.get("content-type")], [200, "text/javascript"]);
    assert.match((await viewer.text()).slice(0, 2000), /@license/, "the package's own built file");
    const meshopt = await get(["meshopt_decoder.js"]);
    assert.deepEqual([meshopt.status, meshopt.headers.get("content-type")], [200, "text/javascript"]);
    assert.match(await meshopt.text(), /var MeshoptDecoder = /, "meshoptimizer's decoder");
    for (const [folder, file, type] of [["draco", "draco_decoder.wasm", "application/wasm"], ["draco", "draco_wasm_wrapper.js", "text/javascript"], ["basis", "basis_transcoder.wasm", "application/wasm"], ["basis", "basis_transcoder.js", "text/javascript"]]) {
      const response = await get([folder, file]);
      assert.deepEqual([response.status, response.headers.get("content-type")], [200, type], file);
      assert.ok((await response.arrayBuffer()).byteLength > 1000, file);
    }
    for (const parts of [["draco", "draco_encoder.js"], ["draco", "../../../../../.env"], ["basis"], ["gltf", "x.js"], ["model-viewer.js"], ["dist", "model-viewer.min.js"]]) assert.equal((await get(parts)).status, 404, parts.join("/"));
  });
});

describe("Module off: the decoders and models aren't served (database copy)", { skip }, () => {
  let was = true;
  before(async () => {
    was = (await prisma.businessSetting.findUniqueOrThrow({ where: { id: "default" }, select: { restaurantEnabled: true } })).restaurantEnabled;
    await prisma.businessSetting.update({ where: { id: "default" }, data: { restaurantEnabled: false } });
  });
  after(async () => {
    await prisma.businessSetting.update({ where: { id: "default" }, data: { restaurantEnabled: was } });
    await prisma.$disconnect();
  });

  test("404", async () => {
    assert.equal((await viewerRoute(new Request("http://localhost/x"), { params: Promise.resolve({ path: ["draco", "draco_decoder.wasm"] }) })).status, 404);
    assert.equal((await mediaRoute(new Request("http://localhost/x"), { params: Promise.resolve({ path: [id.model || "x", "model.glb"] }) })).status, 404);
  });
});
