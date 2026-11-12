import { prisma } from "@/lib/db";
import { getCurrentUserPermissions, isSystemAdmin } from "@/lib/auth/permissions.server";
import { guardFloorPlanPage } from "../server/guard";
import { getFloorEditor } from "../server/queries/floorPlan";
import FloorEditor from "../components/floorPlan/FloorEditor";

// /restaurant/settings/floor — the floor plan editor (Part 7): each dining
// area laid out to match its room. Manage Floor Plan only, checked here on
// the server (a redirect otherwise) and again by every action.
export default async function FloorPlanPage() {
  const { userId } = await guardFloorPlanPage();
  const [areas, current, user] = await Promise.all([
    getFloorEditor(),
    getCurrentUserPermissions(),
    prisma.user.findUnique({ where: { id: userId }, select: { userRole: { select: { name: true } } } }),
  ]);
  const admin = await isSystemAdmin(current);
  return <FloorEditor areas={areas} role={{ name: user?.userRole?.name ?? (admin ? "Administrator" : "Manager"), admin }} />;
}
