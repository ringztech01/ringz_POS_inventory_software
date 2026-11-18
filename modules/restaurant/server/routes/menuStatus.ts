import "server-only";
import { prisma } from "@/lib/db";
import { BUSINESS_SETTINGS_ID } from "@/lib/business-settings";
import { loadMenuStatuses } from "../queries/publicMenu";
import { guestDeviceOf } from "../guestDevice";
import { guestOrderingFor, guestOrderView } from "../services/guestOrders";
import { guestServiceState } from "../services/tableRequests";

// GET /menu/[qrToken]/status — the guest menu's live check (Part 8 Step 3):
// each listed item's state ("available" | "sold_out" | "unavailable"); at a
// table with the guest buttons on (Step 6), where its Call waiter / Request
// bill stand ("open" | "acknowledged" | null); with guest ordering on (Step
// 7), whether it's paused and this phone's own lines and where each is.
// Never who, never another phone's order. 404 while the module is off, the
// menu is switched off or the code no longer works (the page then reloads
// and says so). Public.
export async function GET(request: Request, { params }: { params: Promise<{ qrToken: string }> }) {
  const { qrToken } = await params;
  const statuses = await loadMenuStatuses(qrToken);
  if (!statuses) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  const [service, ordering] = await Promise.all([guestServiceState(qrToken), guestOrderingFor(qrToken)]);
  let order = null;
  if (ordering) {
    const settings = await prisma.menuSettings.findUnique({ where: { businessId: BUSINESS_SETTINGS_ID }, select: { showPrices: true } });
    const view = await guestOrderView(qrToken, guestDeviceOf(request), settings?.showPrices !== false);
    order = { paused: ordering.paused, lines: view?.lines ?? [] };
  }
  return Response.json({ statuses, requests: service?.requests ?? null, order }, { headers: { "Cache-Control": "no-store" } });
}
