import { DEPARTMENTS, type Department } from "./posGrid";
import type { PosMenuTree } from "./posMenu";
import type { MenuAvailability } from "./menuAvailability";
import { MENU_STRINGS } from "./menuStrings";

// The guest's digital menu (Part 8 Step 3), pure: what the public page and
// its live availability check send. Nothing back-office goes in here: no
// cost, stock, staff or orders — an item is its name, words, price, media
// flags and one of three states.

// The three states a guest sees (lib/menuAvailability's, renamed):
// unavailable — switched off (wins); sold_out — out of stock; available.
export type MenuStatus = "available" | "sold_out" | "unavailable";

export const statusOf = (availability: MenuAvailability): MenuStatus => (availability === "out_of_stock" ? "sold_out" : availability);

export type PublicMenuItem = {
  id: string;
  name: string;
  description: string | null;
  // Formatted as the POS shows it; null when prices are hidden.
  price: string | null;
  // The same in kobo, for the basket's running total (Step 7: shown only —
  // the server prices every line itself); null when prices are hidden.
  kobo: number | null;
  status: MenuStatus;
  photo: { thumb: string; full: string } | null;
  signature: boolean;
  // The menu shows a 360° spin (its frames, 24–36, in order) / a 3D model
  // (GLB; USDZ for iPhone AR) — only when that's the item's media type and
  // its files are there. Otherwise the photo.
  spin: boolean;
  model: boolean;
  spinFrames: string[] | null;
  modelFiles: { glb: string; usdz: string | null } | null;
  // Empty when allergens or calories are switched off.
  allergens: string[];
  calories: number | null;
  // Its option groups, as the POS shows them (picked from when guests can
  // order, Step 7; read-only otherwise).
  modifiers: PublicModifierGroup[];
  department: Department;
  sectionId: string;
};

// min / max: the POS's rule (lib/modifiers checkSelection); kobo: each
// option's price change, null when prices are hidden.
export type PublicModifierGroup = { id: string; name: string; rule: string; min: number; max: number; options: { id: string; name: string; price: string; kobo: number | null }[] };

// "1500.00" → 150000 (kobo), for the basket's running total.
export const toKobo = (amount: string) => Math.round(Number(amount) * 100);

export type PublicMenuSection = { id: string; name: string; department: Department };

// What the live check sends: each listed item's state (an item no longer
// listed is missing).
export type MenuStatuses = Record<string, MenuStatus>;

export type PublicMenuWhere = {
  // "Table T4" or the QR point's name; the area (tables only).
  title: string;
  area: string | null;
  // A Bar point opens on the Bar tab.
  startDepartment: Department;
};

export type PublicMenuHeader = {
  title: string;
  welcome: string | null;
  footer: string | null;
  logo: string | null;
  accent: string;
  notes: string[];
};

// ₦1,500.00 (the POS's) or NGN 1,500.00 — the app's currency is the naira.
export function formatMenuPrice(price: string, display: "SYMBOL" | "CODE"): string {
  const number = new Intl.NumberFormat("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(price));
  return display === "CODE" ? `NGN ${number}` : `₦${number}`;
}

// The header's small print: tax included (no listed item adds tax at the
// bill) or added, and the service charge when the business has one.
export function priceNotes({ anyTaxAdded, servicePercent }: { anyTaxAdded: boolean; servicePercent: string | null }): string[] {
  const notes: string[] = [anyTaxAdded ? MENU_STRINGS.taxAdded : MENU_STRINGS.pricesIncludeTax];
  const percent = servicePercent === null ? 0 : Number(servicePercent);
  if (percent > 0) notes.push(MENU_STRINGS.serviceCharge(String(Number(percent.toFixed(2)))));
  return notes;
}

// An item adds tax at the bill when it's EXCLUSIVE with a rate above 0.
export const addsTax = (item: { taxType: string; orderTax: string | number | null }) => item.taxType === "EXCLUSIVE" && Number(item.orderTax ?? 0) > 0;

// Allergens are a JSON array of names: kept only as short, trimmed text.
export function allergensOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const names = value.filter((v): v is string => typeof v === "string").map((v) => v.trim().slice(0, 40)).filter(Boolean);
  return [...new Set(names)].slice(0, 14);
}

// A 360° spin shows only with a full set of frames.
export const spinReady = (frames: unknown) => Array.isArray(frames) && frames.length >= 24 && frames.length <= 36 && frames.every((f) => typeof f === "string" && f.length > 0);

// A menu item's media and its public URLs. Files live under
// uploads/menu/<productId>/ (Part 8 Step 5); the guest gets each from
// /menu/media/<productId>/<file>. A "-1200" photo has its "-400" thumbnail
// beside it.
export const MEDIA_FILE = /^[a-z0-9][a-z0-9._-]{0,80}\.(webp|jpe?g|png|glb|usdz)$/i;
const IMAGE = /\.(webp|jpe?g|png)$/i;

export function mediaUrl(productId: string, stored: string | null | undefined, kind: "image" | "glb" | "usdz"): string | null {
  if (!stored || !/^[a-z0-9_-]{1,40}$/i.test(productId)) return null;
  const file = stored.split("/").pop() ?? "";
  const right = kind === "image" ? IMAGE.test(file) : file.toLowerCase().endsWith(`.${kind}`);
  return MEDIA_FILE.test(file) && right ? `/menu/media/${productId}/${file}` : null;
}

export function photoUrls(productId: string, photoPath: string | null): { thumb: string; full: string } | null {
  const full = mediaUrl(productId, photoPath, "image");
  return full ? { full, thumb: full.replace(/-1200\.(\w+)$/, "-400.$1") } : null;
}

// The spin's frames, in order — all of them usable, or none.
export function spinUrls(productId: string, frames: unknown): string[] | null {
  if (!spinReady(frames)) return null;
  const urls = (frames as string[]).map((f) => mediaUrl(productId, f, "image"));
  return urls.every((u): u is string => u !== null) ? urls : null;
}

// What the item shows: its chosen media type, if its files are there.
export function menuMedia(productId: string, item: { mediaType: string; spinFrames: unknown; modelGlbPath: string | null; modelUsdzPath: string | null }) {
  const frames = item.mediaType === "SPIN" ? spinUrls(productId, item.spinFrames) : null;
  const glb = item.mediaType === "MODEL" ? mediaUrl(productId, item.modelGlbPath, "glb") : null;
  return {
    spinFrames: frames,
    modelFiles: glb ? { glb, usdz: mediaUrl(productId, item.modelUsdzPath, "usdz") } : null,
  };
}

// An option's price change as the menu shows prices (₦ or NGN); none when
// prices are hidden.
export function optionPrice(posPrice: string, display: "SYMBOL" | "CODE", showPrices: boolean): string {
  if (!showPrices || !posPrice) return "";
  return display === "CODE" ? posPrice.replace("₦", "NGN ") : posPrice;
}

// Sections in the POS's order (lib/posMenu): each department's top groups
// (then its auto groups — a category — for dishes not in a group yet), a
// sub-group's dishes folded into its top group, dishes in their grid order.
// Only sections with a listed dish, and only listed dishes.
export function menuSections(tree: PosMenuTree, listed: ReadonlySet<string>): { sections: PublicMenuSection[]; order: string[]; sectionOf: Record<string, string> } {
  const sections: PublicMenuSection[] = [];
  const order: string[] = [];
  const sectionOf: Record<string, string> = {};
  const walk = (groupId: string, top: string, depth: number) => {
    if (depth > 20) return;
    for (const cell of tree.grids[groupId] ?? []) {
      if (!cell) continue;
      if (cell.kind === "group") walk(cell.id, top, depth + 1);
      else if (listed.has(cell.id) && !(cell.id in sectionOf)) {
        order.push(cell.id);
        sectionOf[cell.id] = top;
      }
    }
  };
  for (const department of DEPARTMENTS) {
    for (const top of tree.row[department]) {
      const before = order.length;
      walk(top, top, 0);
      if (order.length > before) sections.push({ id: top, name: tree.groups[top]?.name ?? "", department });
    }
  }
  return { sections, order, sectionOf };
}

// What a guest sees: sold-out items greyed, or hidden when the menu says so.
export const shownOnMenu = (status: MenuStatus, showSoldOut: boolean) => showSoldOut || status !== "sold_out";

// Search on the phone: every word typed must be in the name or description.
export function matchesSearch(item: Pick<PublicMenuItem, "name" | "description">, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = `${item.name} ${item.description ?? ""}`.toLowerCase();
  return words.every((w) => text.includes(w));
}

// A QR token as made by lib/qrToken (base64url): anything else is looked up
// no further.
export const looksLikeToken = (token: string) => /^[A-Za-z0-9_-]{16,64}$/.test(token);

// The guest menu's pages and files (/menu, /menu/…): public — no sign-in,
// and staff signed in on the same phone aren't sent to their home screen.
export const isGuestMenuPath = (pathname: string) => pathname === "/menu" || pathname.startsWith("/menu/");

// Set by the proxy on guest menu requests only: the root layout then leaves
// out everything the back office loads (web fonts, toasts).
export const GUEST_SURFACE_HEADER = "x-ringz-surface";
