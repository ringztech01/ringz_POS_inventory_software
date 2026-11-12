import "server-only";
import type { NextRequest } from "next/server";
import { RESTAURANT_PERMISSIONS } from "../../manifest";
import { guardRoute } from "../guard";
import { readFloorImage } from "../services/floorImage";

// GET /restaurant/settings/floor/image/[areaId] — the area's floor plan
// image, for the editor's Trace image. Manage Floor Plan only (404 with the
// module off). The editor asks for it with ?v=<file name>, so a new image is
// a new URL and each one can be cached by the browser.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ areaId: string }> }) {
  const denied = await guardRoute(RESTAURANT_PERMISSIONS.MANAGE_FLOOR_PLAN);
  if (denied) return denied;

  const { areaId } = await params;
  const image = await readFloorImage(areaId);
  if (!image) return new Response("No floor plan image", { status: 404 });
  return new Response(new Uint8Array(image.bytes), {
    headers: {
      "Content-Type": image.contentType,
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
