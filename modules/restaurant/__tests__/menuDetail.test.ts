// Run with: npx tsx --test modules/restaurant/__tests__/menuDetail.test.ts
// Part 8 Step 4: the item detail's rules — its media, its options' prices,
// the slow-phone and drag rules, the Lighter menu — and, from the source,
// that the 3D viewer only ever loads on a tap and never from a CDN.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { mediaUrl, menuMedia, optionPrice, photoUrls, spinUrls } from "../lib/publicMenu";
import { INERTIA_STOP, dragTo, frameAt, inertia, isSlowDevice, readLighter, writeLighter, LIGHTER_KEY } from "../lib/menuDevice";

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
const frames = (id: string, n: number) => Array.from({ length: n }, (_, i) => `menu/${id}/spin-${String(i).padStart(2, "0")}.webp`);

describe("an item's media", () => {
  test("URLs under /menu/media/<item>/ — the right kind of file only, never a path", () => {
    assert.equal(mediaUrl("cm1", "menu/cm1/model.glb", "glb"), "/menu/media/cm1/model.glb");
    assert.equal(mediaUrl("cm1", "menu/cm1/model.usdz", "usdz"), "/menu/media/cm1/model.usdz");
    assert.equal(mediaUrl("cm1", "menu/cm1/model.glb", "image"), null, "a model isn't a picture");
    assert.equal(mediaUrl("cm1", "menu/cm1/photo.webp", "glb"), null);
    assert.equal(mediaUrl("cm1", "menu/cm1/../../.env", "image"), null);
    assert.equal(mediaUrl("../cm1", "menu/x/photo.webp", "image"), null);
    assert.equal(mediaUrl("cm1", "", "image"), null);
    assert.deepEqual(photoUrls("cm1", "menu/cm1/photo-1200.jpg"), { full: "/menu/media/cm1/photo-1200.jpg", thumb: "/menu/media/cm1/photo-400.jpg" });
  });

  test("360°: every frame usable, in order — or none", () => {
    assert.deepEqual(spinUrls("cm1", frames("cm1", 24))?.slice(0, 2), ["/menu/media/cm1/spin-00.webp", "/menu/media/cm1/spin-01.webp"]);
    assert.equal(spinUrls("cm1", frames("cm1", 24))?.length, 24);
    assert.equal(spinUrls("cm1", [...frames("cm1", 23), "menu/cm1/x.glb"]), null, "one bad frame: no spin");
    assert.equal(spinUrls("cm1", frames("cm1", 20)), null, "too few");
  });

  test("the item's chosen media type decides; its files must be there", () => {
    const base = { spinFrames: frames("cm1", 30), modelGlbPath: "menu/cm1/model.glb", modelUsdzPath: null };
    assert.deepEqual(menuMedia("cm1", { ...base, mediaType: "PHOTO" }), { spinFrames: null, modelFiles: null }, "Photo: neither, even with files");
    assert.equal(menuMedia("cm1", { ...base, mediaType: "SPIN" }).spinFrames?.length, 30);
    assert.deepEqual(menuMedia("cm1", { ...base, mediaType: "MODEL" }).modelFiles, { glb: "/menu/media/cm1/model.glb", usdz: null });
    assert.deepEqual(menuMedia("cm1", { ...base, mediaType: "MODEL", modelUsdzPath: "menu/cm1/model.usdz" }).modelFiles, { glb: "/menu/media/cm1/model.glb", usdz: "/menu/media/cm1/model.usdz" });
    assert.deepEqual(menuMedia("cm1", { ...base, mediaType: "MODEL", modelGlbPath: null }), { spinFrames: null, modelFiles: null }, "3D with no GLB: the photo");
    assert.deepEqual(menuMedia("cm1", { ...base, mediaType: "SPIN", spinFrames: null }), { spinFrames: null, modelFiles: null });
  });

  test("an option's price change as the menu shows prices; none when prices are hidden", () => {
    assert.deepEqual([optionPrice("+₦500.00", "SYMBOL", true), optionPrice("+₦500.00", "CODE", true), optionPrice("", "SYMBOL", true), optionPrice("+₦500.00", "SYMBOL", false)], ["+₦500.00", "+NGN 500.00", "", ""]);
  });
});

describe("the phone", () => {
  test("a slow phone or connection holds the 360° back until a tap", () => {
    assert.equal(isSlowDevice({}), false);
    assert.equal(isSlowDevice({ hardwareConcurrency: 8, deviceMemory: 4, connection: { effectiveType: "4g", saveData: false } }), false);
    for (const slow of [{ connection: { saveData: true } }, { connection: { effectiveType: "3g" } }, { connection: { effectiveType: "slow-2g" } }, { deviceMemory: 2 }, { deviceMemory: 1 }, { hardwareConcurrency: 2 }]) {
      assert.equal(isSlowDevice(slow), true, JSON.stringify(slow));
    }
    assert.equal(isSlowDevice({ hardwareConcurrency: 0, deviceMemory: 0 }), false, "unknown isn't slow");
  });

  test("dragging turns the spin: left is forward, and it wraps round", () => {
    assert.equal(frameAt(dragTo(0, -80), 24), 10, "80 px left: 10 frames on");
    assert.equal(frameAt(dragTo(0, 16), 24), 22, "16 px right: 2 back, wrapped");
    assert.equal(frameAt(24, 24), 0);
    assert.equal(frameAt(-1, 24), 23);
    assert.equal(frameAt(5, 0), 0);
  });

  test("after the finger lifts it slows and stops", () => {
    let state = { position: 0, velocity: 0.05, done: false };
    let steps = 0;
    while (!state.done && steps < 500) {
      state = inertia(state.position, state.velocity);
      steps++;
    }
    assert.ok(state.done && steps < 100, `stops (${steps} frames)`);
    assert.ok(Math.abs(state.velocity) < INERTIA_STOP);
    assert.ok(state.position > 0, "kept turning the way it was going");
  });

  test("Lighter menu: remembered on the phone; a phone that won't store just forgets", () => {
    const memory = new Map<string, string>();
    const store = { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => void memory.set(k, v), removeItem: (k: string) => void memory.delete(k) };
    assert.equal(readLighter(store), false);
    writeLighter(store, true);
    assert.deepEqual([readLighter(store), memory.get(LIGHTER_KEY)], [true, "1"]);
    writeLighter(store, false);
    assert.equal(readLighter(store), false);
    const refusing = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); }, removeItem: () => { throw new Error("denied"); } };
    assert.equal(readLighter(refusing), false);
    assert.doesNotThrow(() => writeLighter(refusing, true));
    assert.equal(readLighter(null), false);
  });
});

describe("3D: only on a tap, never from a CDN", () => {
  const files = (dir: string): string[] => readdirSync(path.join(process.cwd(), dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]));

  test("model-viewer isn't in the page's bundle: its built file is added only on the tap", () => {
    const users = files("modules").filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes("__tests__") && /from "@google\/model-viewer"|import\("@google\/model-viewer"\)/.test(read(f)));
    assert.deepEqual(users, [], "never imported (statically or dynamically) by the app's code");
    const loader = read("modules/restaurant/components/publicMenu/loadModelViewer.ts");
    assert.match(loader, /const SCRIPT = "\/menu\/viewer\/model-viewer\.min\.js";/);
    assert.match(loader, /script\.type = "module";/);
    assert.match(read("modules/restaurant/components/publicMenu/ItemMedia.tsx"), /loadModelViewer\(\)/);
    assert.match(read("modules/restaurant/server/routes/menuViewer.ts"), /"@google", "model-viewer", "dist", "model-viewer\.min\.js"/);
  });

  test("its decoders come from this server, not Google's CDN", () => {
    const loader = read("modules/restaurant/components/publicMenu/loadModelViewer.ts");
    assert.match(loader, /dracoDecoderLocation = "\/menu\/viewer\/draco\/"/);
    assert.match(loader, /ktx2TranscoderLocation = "\/menu\/viewer\/basis\/"/);
    assert.match(loader, /meshoptDecoderLocation = "\/menu\/viewer\/meshopt_decoder\.js"/, "Meshopt: or compressed models don't open");
    for (const f of files("modules/restaurant/components/publicMenu")) assert.doesNotMatch(read(f), /gstatic|jsdelivr|unpkg|googleapis/, f);
    assert.match(read("modules/restaurant/server/routes/menuViewer.ts"), /if \(!\(await isModuleEnabled\(restaurantModule\.id\)\)\) return notFound\(\);/);
  });

  test("no `any` in the item detail's code", () => {
    const own = ["lib/menuDevice.ts", "components/publicMenu/ItemMedia.tsx", "components/publicMenu/ItemSheet.tsx", "components/publicMenu/loadModelViewer.ts", "server/routes/menuViewer.ts"].map((f) => `modules/restaurant/${f}`);
    assert.deepEqual(own.filter((f) => /(:\s*any\b|\bas any\b|<any>|any\[\])/.test(read(f))), []);
  });
});
