import { z } from "zod";

export const warehouseSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(150),
  email: z.string().trim().min(1, "Email is required.").email("Please enter a valid email address."),
  phoneNumber: z.string().trim().min(1, "Phone number is required.").max(30),
  country: z.string().trim().min(1, "Country is required.").max(100),
  city: z.string().trim().min(1, "City is required.").max(100),
  zipCode: z.string().trim().min(1, "Zip code is required.").max(20),
});

export type WarehouseInput = z.infer<typeof warehouseSchema>;
