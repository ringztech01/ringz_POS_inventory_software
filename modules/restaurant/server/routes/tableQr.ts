import "server-only";
import type { NextRequest } from "next/server";
import { RESTAURANT_PERMISSIONS } from "../../manifest";
import { guardRoute } from "../guard";
import { appOrigin, menuUrl, qrPng } from "../qr";
import { getTableQr } from "../queries/tables";

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "table";

// GET /restaurant/tables/[id]/qr — the table's menu QR code as a PNG
// download (qr-main-hall-t4.png). Needs Manage Tables.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guardRoute(RESTAURANT_PERMISSIONS.MANAGE_TABLES);
  if (denied) return denied;

  const { id } = await params;
  const table = await getTableQr(id);
  if (!table) return new Response("Table not found", { status: 404 });

  const png = await qrPng(menuUrl(await appOrigin(), table.qrToken));
  return new Response(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Content-Disposition": `attachment; filename="qr-${slug(table.area.name)}-${slug(table.name)}.png"`,
      "Cache-Control": "no-store",
    },
  });
}
