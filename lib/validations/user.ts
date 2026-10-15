import { z } from "zod";
import { Role } from "@prisma/client";

export const createUserSchema = z
  .object({
    firstName: z.string().trim().min(1, "First name is required.").max(100),
    lastName: z.string().trim().min(1, "Last name is required.").max(100),
    email: z.string().trim().min(1, "Email is required.").email("Please enter a valid email address."),
    phoneNumber: z.string().trim().min(1, "Phone number is required.").max(30),
    password: z.string().min(8, "Password must be at least 8 characters."),
    confirmPassword: z.string().min(1, "Please confirm the password."),
    role: z.nativeEnum(Role, { message: "Please choose a role." }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Password and confirmation do not match.",
    path: ["confirmPassword"],
  });

// Same fields as create, but both password fields are optional — left blank
// means "keep the existing password" (see updateUser in
// app/(dashboard)/peoples/users/actions.ts). Confirmation is still required
// to match whenever a new password is actually provided.
export const updateUserSchema = z
  .object({
    firstName: z.string().trim().min(1, "First name is required.").max(100),
    lastName: z.string().trim().min(1, "Last name is required.").max(100),
    email: z.string().trim().min(1, "Email is required.").email("Please enter a valid email address."),
    phoneNumber: z.string().trim().min(1, "Phone number is required.").max(30),
    password: z.string().trim().optional(),
    confirmPassword: z.string().trim().optional(),
    role: z.nativeEnum(Role, { message: "Please choose a role." }),
  })
  .refine((data) => !data.password || data.password.length >= 8, {
    message: "Password must be at least 8 characters.",
    path: ["password"],
  })
  .refine((data) => (data.password || data.confirmPassword ? data.password === data.confirmPassword : true), {
    message: "Password and confirmation do not match.",
    path: ["confirmPassword"],
  });
