import "server-only";
import sharp from "sharp";
import { isModuleEnabled } from "@/lib/modules/enabled.server";
import { restaurantModule } from "../../manifest";

// The tablet screens as an installed app (Part 6g Step 1): "RingzPOS
// Waiter". Its manifest, icons, service worker and offline page — public
// (the browser fetches them without the session), a 404 while the module
// is off. Nothing here needs the internet.

const off = async () => !(await isModuleEnabled(restaurantModule.id));
const notFound = () => new Response("Not found", { status: 404 });

// /t/manifest.webmanifest. Orientation "any": Tables follows the tablet's
// rotation (the floor view in landscape); the PIN login and Order screens
// lock themselves upright (TabletShell), since a manifest can only set one
// orientation for the whole app.
export async function manifestGET(): Promise<Response> {
  if (await off()) return notFound();
  const manifest = {
    name: "RingzPOS Waiter",
    short_name: "RingzPOS",
    description: "Tables and orders for waiters, bar and kitchen staff.",
    id: "/t/",
    start_url: "/t/tables",
    scope: "/t/",
    display: "standalone",
    orientation: "any",
    background_color: "#0E0F11",
    theme_color: "#000000",
    icons: [
      { src: "/t/icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/t/icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/t/icon/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
  return new Response(JSON.stringify(manifest), { headers: { "Content-Type": "application/manifest+json", "Cache-Control": "no-cache" } });
}

// A white "R" on black, drawn as strokes (no font needed), inside the
// maskable safe zone.
const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#000"/><path d="M188 384V136h92a68 68 0 0 1 0 136h-92M268 272l76 112" fill="none" stroke="#fff" stroke-width="56" stroke-linecap="square" stroke-linejoin="miter"/><rect x="160" y="404" width="192" height="20" fill="#0B8A73"/></svg>`;
const SIZES = new Set([192, 512]);
const icons = new Map<number, Buffer>();

// /t/icon/[size] — 192 or 512 px PNG.
export async function iconGET(_request: Request, { params }: { params: Promise<{ size: string }> }): Promise<Response> {
  if (await off()) return notFound();
  const size = Number((await params).size);
  if (!SIZES.has(size)) return notFound();
  let png = icons.get(size);
  if (!png) {
    png = await sharp(Buffer.from(ICON_SVG)).resize(size, size).png().toBuffer();
    icons.set(size, png);
  }
  return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" } });
}

// /t/sw.js — keeps the offline page, and shows it when a tablet screen
// can't load (the server's down or the Wi-Fi dropped). Screens themselves
// are never cached: they're always live.
const SERVICE_WORKER = `
const CACHE = "ringz-tablet-v1";
const OFFLINE = "/t/offline";
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add(new Request(OFFLINE, { cache: "reload" }))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.mode !== "navigate") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith("/t/")) return;
  event.respondWith(fetch(request).catch(() => caches.match(OFFLINE).then((page) => page || new Response("Can't reach server, retrying…", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } }))));
});
`;

export async function serviceWorkerGET(): Promise<Response> {
  if (await off()) return notFound();
  return new Response(SERVICE_WORKER, { headers: { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-cache", "Service-Worker-Allowed": "/t/" } });
}

// /t/offline — shown in place of a screen that couldn't load. Tries the
// server every 3 s and, once it answers, loads the screen again.
const OFFLINE_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#000000">
<title>RingzPOS Waiter</title>
<style>html,body{margin:0;height:100%;background:#0E0F11;color:#fff;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}
main{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;text-align:center;padding:32px;box-sizing:border-box}
b{font-size:40px;font-weight:900}span{font-size:20px;font-weight:700;color:#9AA1A8}i{width:14px;height:14px;border-radius:50%;background:#C81E1E;display:inline-block;margin-right:10px}</style></head>
<body><main data-tablet-offline><b>Can't reach server, retrying…</b><span><i></i>Check the tablet's Wi-Fi. This screen comes back on its own.</span></main>
<script>
setInterval(function () {
  fetch("/t/offline?ping=" + Date.now(), { cache: "no-store" }).then(function (r) {
    if (!r.ok) return;
    if (location.pathname === "/t/offline") location.replace("/t/tables"); else location.reload();
  }).catch(function () {});
}, 3000);
</script></body></html>`;

export async function offlineGET(): Promise<Response> {
  if (await off()) return notFound();
  return new Response(OFFLINE_PAGE, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" } });
}
