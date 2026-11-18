import "server-only";
import { z } from "zod";
import { isModuleEnabled } from "@/lib/modules/enabled.server";
import { GUEST_LINE_QTY_MAX, GUEST_MAX_LINES_LIMIT, GUEST_NAME_MAX, GUEST_NOTE_MAX, isLanRequest } from "../../lib/guestOrdering";
import { restaurantModule } from "../../manifest";
import { guestAddress, guestDeviceCookie, guestDeviceOf, newGuestDevice } from "../guestDevice";
import { GUEST_ERRORS, orderingSettings, placeGuestOrder } from "../services/guestOrders";

// POST /menu/[qrToken]/order — a guest's Send to waiter (Part 8 Step 7):
// { lines: [{ productId, modifierIds, note, quantity }], name? } — never a
// price; `name` at a QR point (Step 8), the order's.
// Public, from the restaurant's network only, from the menu page itself.
// Answers { ok, mode } or { ok: false, error, productId? }. 404 while the
// module is off.

const lineSchema = z.object({
  productId: z.string().min(1).max(191),
  modifierIds: z.array(z.string().min(1).max(191)).max(40),
  note: z.string().max(GUEST_NOTE_MAX).default(""),
  quantity: z.number().int().min(1).max(GUEST_LINE_QTY_MAX),
});
const bodySchema = z.object({ lines: z.array(lineSchema).max(GUEST_MAX_LINES_LIMIT), name: z.string().max(GUEST_NAME_MAX * 2).optional() });
const BAD = "Something in that wasn't right. Please try again.";

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === request.headers.get("host");
  } catch {
    return false;
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ qrToken: string }> }) {
  if (!(await isModuleEnabled(restaurantModule.id))) return new Response("Not found", { status: 404 });
  const existing = guestDeviceOf(request);
  const deviceId = existing ?? newGuestDevice();
  const headers: Record<string, string> = { "Cache-Control": "no-store", ...(existing ? {} : { "Set-Cookie": guestDeviceCookie(deviceId) }) };
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
  if (!sameOrigin(request)) return json({ ok: false, error: "Not allowed." }, 403);
  try {
    const settings = await orderingSettings();
    if (!isLanRequest(request.headers.get("host"), request.headers.get("x-forwarded-for"), settings.savedHost)) return json({ ok: false, error: GUEST_ERRORS.notLan }, 403);
    let input: unknown;
    try {
      input = await request.json();
    } catch {
      return json({ ok: false, error: BAD }, 400);
    }
    const parsed = bodySchema.safeParse(input);
    if (!parsed.success) return json({ ok: false, error: BAD }, 400);
    const { qrToken } = await params;
    const result = await placeGuestOrder(qrToken, parsed.data.lines, { id: deviceId, ip: guestAddress(request), userAgent: request.headers.get("user-agent") ?? "" }, new Date(), parsed.data.name ?? null);
    if (!result.ok) return json({ ok: false, error: result.error, ...(result.productId ? { productId: result.productId } : {}) }, result.status);
    return json({ ok: true, mode: result.mode });
  } catch (error) {
    console.error("[restaurant] guest order failed:", error);
    return json({ ok: false, error: "Something went wrong. Please ask your waiter." }, 500);
  }
}
