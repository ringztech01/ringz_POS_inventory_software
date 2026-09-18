"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { saveAvatarImage } from "@/lib/uploads";
import { profileUpdateSchema } from "@/lib/validations/profile";
import type { ProfileActionState } from "./types";

export async function updateProfile(formData: FormData): Promise<ProfileActionState> {
  // Always re-read the id from the session — never trust a client-supplied id,
  // otherwise a request could edit an arbitrary user's profile.
  const session = await auth();
  if (!session?.user?.id) {
    return { status: "error", message: "You must be signed in to update your profile." };
  }

  const userId = session.user.id;

  const parsed = profileUpdateSchema.safeParse({
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    email: formData.get("email"),
    phoneNumber: formData.get("phoneNumber"),
  });

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const { firstName, lastName, email, phoneNumber } = parsed.data;

  // Deliberately not reading a "role" field from formData here. This is a
  // self-service profile page — a user must never be able to promote their
  // own account. Role changes are a separate, admin-only action gated on
  // the Users page, not something this form can influence.

  const existingWithEmail = await prisma.user.findUnique({ where: { email } });
  if (existingWithEmail && existingWithEmail.id !== userId) {
    return { status: "error", message: "That email is already in use by another account." };
  }

  let imagePath: string | undefined;
  const imageFile = formData.get("image");
  if (imageFile instanceof File && imageFile.size > 0) {
    try {
      imagePath = await saveAvatarImage(imageFile, userId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not save the uploaded image.";
      return { status: "error", message };
    }
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      firstName,
      lastName,
      email,
      phoneNumber: phoneNumber || null,
      ...(imagePath ? { image: imagePath } : {}),
    },
  });

  revalidatePath("/profile");

  return {
    status: "success",
    message: "Profile updated successfully.",
    user: {
      firstName: updated.firstName,
      lastName: updated.lastName,
      email: updated.email,
      phoneNumber: updated.phoneNumber,
      image: updated.image,
    },
  };
}
