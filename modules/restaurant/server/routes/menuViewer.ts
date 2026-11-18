import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { isModuleEnabled } from "@/lib/modules/enabled.server";
import { restaurantModule } from "../../manifest";

// GET /menu/viewer/model-viewer.min.js — the 3D viewer itself, the
// package's ready-built file (added to a guest's page only when they tap
// "View in 3D"); /menu/viewer/meshopt_decoder.js, meshoptimizer's decoder
// (Meshopt-compressed models, Step 5); and /menu/viewer/<draco|basis>/<file>,
// its decoders for Draco meshes and KTX2 textures from three.js. All from
// node_modules, so the menu's 3D works with no internet: <model-viewer>
// would otherwise fetch its decoders from Google's CDN (Part 8 Step 4).
// Only these files; 404 while the module is off.

const LIBS = path.join(process.cwd(), "node_modules", "three", "examples", "jsm", "libs");
// Single files: the viewer itself, and meshoptimizer's decoder script —
// <model-viewer> only switches on its Meshopt support (Step 5's compressed
// models) once that script has loaded.
const SINGLE: Record<string, { file: string; type: string }> = {
  "model-viewer.min.js": { file: path.join(process.cwd(), "node_modules", "@google", "model-viewer", "dist", "model-viewer.min.js"), type: "text/javascript" },
  "meshopt_decoder.js": { file: path.join(process.cwd(), "node_modules", "meshoptimizer", "meshopt_decoder.cjs"), type: "text/javascript" },
};
const FILES: Record<string, Record<string, string>> = {
  draco: { "draco_decoder.wasm": "application/wasm", "draco_wasm_wrapper.js": "text/javascript", "draco_decoder.js": "text/javascript" },
  basis: { "basis_transcoder.wasm": "application/wasm", "basis_transcoder.js": "text/javascript" },
};

export async function GET(_request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const notFound = () => new Response("Not found", { status: 404 });
  if (!(await isModuleEnabled(restaurantModule.id))) return notFound();
  const parts = (await params).path;
  const single = parts.length === 1 ? SINGLE[parts[0]] : undefined;
  const [folder, file] = parts;
  const type = single ? single.type : parts.length === 2 ? FILES[folder]?.[file] : undefined;
  if (!type) return notFound();
  try {
    const bytes = await readFile(single ? single.file : path.join(LIBS, folder, file));
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": type, "Cache-Control": "public, max-age=86400", "X-Content-Type-Options": "nosniff" } });
  } catch {
    return notFound();
  }
}
