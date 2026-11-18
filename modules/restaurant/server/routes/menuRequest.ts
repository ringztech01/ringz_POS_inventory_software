import "server-only";
import { z } from "zod";
import { isModuleEnabled } from "@/lib/modules/enabled.server";
import { TABLE_REQUEST_TYPES } from "../../lib/tableRequests";
import { restaurantModule } from "../../manifest";
import { createGuestRequest } from "../services/tableRequests";

// POST /menu/[qrToken]/request {"type":"CALL_WAITER"|"REQUEST_BILL"} — a
// guest's Call waiter / Request bill (Part 8 Step 6). Public: the token is
// the only key, and it names a table and nothing else. Answers with where
// the table's requests stand ({ ok, requests } or { ok: false, error }),
// never a staff name. 404 while the module is off.

const bodySchema = z.object({ type: z.enum(TABLE_REQUEST_TYPES) });
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

// Sent by the menu page itself: a form posted from another site is refused.
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
  if (!sameOrigin(request)) return json({ ok: false, error: "Not allowed." }, 403);
  const { qrToken } = await params;
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return json({ ok: false, error: "Something in that wasn't right. Please try again." }, 400);
  }
  const parsed = bodySchema.safeParse(input);
  if (!parsed.success) return json({ ok: false, error: "Something in that wasn't right. Please try again." }, 400);
  try {
    const result = await createGuestRequest(qrToken, parsed.data.type);
    return result.ok ? json({ ok: true, requests: result.requests }) : json({ ok: false, error: result.error }, result.status);
  } catch (error) {
    console.error("[restaurant] guest table request failed:", error);
    return json({ ok: false, error: "Something went wrong. Please ask your waiter." }, 500);
  }
}
