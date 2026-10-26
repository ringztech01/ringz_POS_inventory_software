import "server-only";
import type { ReactNode } from "react";
import ForbiddenState from "@/components/ui/ForbiddenState";
import type { Permission } from "@/lib/permissions";
import { can } from "./permissions.server";

// For server pages: null when the current user has the permission, otherwise
// the 403 state to render instead of the page.
//
//   const denied = await pageGuard(PERMISSIONS.MANAGE_SALE);
//   if (denied) return denied;
export async function pageGuard(permission: Permission): Promise<ReactNode | null> {
  return (await can(permission)) ? null : <ForbiddenState permission={permission} />;
}
