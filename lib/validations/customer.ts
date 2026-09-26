import { z } from "zod";

export const customerSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(150),
  email: z.string().trim().min(1, "Email is required.").email("Please enter a valid email address."),
  phoneNumber: z.string().trim().min(1, "Phone number is required.").max(30),
  dateOfBirth: z
    .string()
    .trim()
    .optional()
    .refine((value) => !value || /^\d{4}-\d{2}-\d{2}$/.test(value), "Please enter a valid date."),
  country: z.string().trim().min(1, "Country is required.").max(100),
  city: z.string().trim().min(1, "City is required.").max(100),
  address: z.string().trim().min(1, "Address is required.").max(500),
});

export type CustomerInput = z.infer<typeof customerSchema>;
