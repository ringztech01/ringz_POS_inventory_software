import "server-only";
import sharp from "sharp";
import { idSchema } from "../../schemas/common";
import { guardMenuQrRoute } from "../guard";
import { buildMenuCards } from "../queries/menuQr";

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "card";

// GET /restaurant/digital-menu/qr-codes/card/<table|point>/<id> — the menu's
// QR card (Part 8 Step 2) as a PNG, 1050 × 1480 (A6 at 254 dpi): the same
// card the page prints. 409 until the menu's address is saved. The
// Administrator or Manage Floor Plan.
export async function GET(_request: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const denied = await guardMenuQrRoute();
  if (denied) return denied;
  const { kind, id } = await params;
  const parsed = idSchema.safeParse(id);
  if ((kind !== "table" && kind !== "point") || !parsed.success) return new Response("Not found", { status: 404 });

  const cards = await buildMenuCards({ kind, id: parsed.data }, "image");
  if (cards === null) return new Response("Save the menu's address first.", { status: 409 });
  if (!cards.length) return new Response("Not found", { status: 404 });
  const png = await sharp(Buffer.from(cards[0].svg)).png({ compressionLevel: 9 }).toBuffer();
  return new Response(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Content-Disposition": `attachment; filename="menu-card-${slug(cards[0].title)}.png"`,
      "Cache-Control": "no-store",
    },
  });
}
