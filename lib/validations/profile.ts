import { z } from "zod";

export const profileUpdateSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required.").max(100),
  lastName: z.string().trim().min(1, "Last name is required.").max(100),
  email: z.string().trim().min(1, "Email is required.").email("Please enter a valid email address."),
  phoneNumber: z.string().trim().max(30).optional(),
});
