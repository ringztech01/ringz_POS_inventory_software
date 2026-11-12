"use server";

import { revalidatePath } from "next/cache";
import { copyRoleSchema, roleMatrixSchema } from "../../schemas/staffRoles";
import { requireAdministrator } from "../guard";
import { safely } from "../safely";
import { copyRole as copyRoleService, saveRoleMatrix as saveRoleMatrixService } from "../services/staffRoles";

// The role matrix (Part 6f Step 2). Administrator only — checked here on the
// server (a Manager calling these directly is refused). Never throws.

const refresh = () => {
  revalidatePath("/settings/restaurant/roles");
  revalidatePath("/roles");
};

export async function saveRoleMatrix(input: unknown): Promise<{ ok: true; changed: number } | { ok: false; error: string }> {
  return safely("save role matrix", async () => {
    const admin = await requireAdministrator();
    if (admin.error !== undefined) return { ok: false as const, error: admin.error };
    const parsed = roleMatrixSchema.safeParse(input);
    if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Those roles can't be saved." };
    const result = await saveRoleMatrixService(parsed.data, admin.userId);
    if (result.ok) refresh();
    return result;
  });
}

export async function copyRole(input: unknown): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  return safely("copy role", async () => {
    const admin = await requireAdministrator();
    if (admin.error !== undefined) return { ok: false as const, error: admin.error };
    const parsed = copyRoleSchema.safeParse(input);
    if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? "That role can't be copied." };
    const result = await copyRoleService(parsed.data, admin.userId);
    if (result.ok) refresh();
    return result;
  });
}
