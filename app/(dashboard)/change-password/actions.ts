"use server";

import bcrypt from "bcryptjs";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { changePasswordSchema } from "@/lib/validations/password";
import type { ChangePasswordActionState } from "./types";

export async function changePassword(formData: FormData): Promise<ChangePasswordActionState> {
  // Always re-read the id from the session — never trust a client-supplied id,
  // otherwise a request could change an arbitrary user's password.
  const session = await auth();
  if (!session?.user?.id) {
    return { status: "error", message: "You must be signed in to change your password." };
  }

  const parsed = changePasswordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const { currentPassword, newPassword } = parsed.data;

  const user = await prisma.user.findFirst({ where: { id: session.user.id, deletedAt: null } });
  if (!user) {
    return { status: "error", message: "Account not found." };
  }

  const currentPasswordMatches = await bcrypt.compare(currentPassword, user.password);
  if (!currentPasswordMatches) {
    return { status: "error", message: "Current password is incorrect." };
  }

  const newPasswordIsSameAsCurrent = await bcrypt.compare(newPassword, user.password);
  if (newPasswordIsSameAsCurrent) {
    return { status: "error", message: "New password must be different from your current password." };
  }

  const hashedPassword = await bcrypt.hash(newPassword, 10);

  await prisma.user.update({
    where: { id: user.id },
    data: { password: hashedPassword },
  });

  // Possible enhancement: sign the user out here so they must re-authenticate
  // with the new password (stronger session hygiene after a credential
  // change). Not implemented yet — left as a deliberate follow-up decision
  // rather than something to do silently as part of this action.

  return { status: "success", message: "Password updated." };
}
