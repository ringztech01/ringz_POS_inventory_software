import { z } from "zod";

// Part 6f Step 1: the restaurant's view (Settings › Restaurant › Interface)
// and a device's own (Settings › Devices; null: follow the business).
export const restaurantViewSchema = z.enum(["SERVICE", "CLASSIC"], { message: "Pick Service or Classic." });
export const interfaceSchema = z.object({ view: restaurantViewSchema });
export const deviceInterfaceSchema = z.object({
  deviceId: z.string().regex(/^[0-9a-f-]{36}$/, "That device isn't known."),
  view: restaurantViewSchema.nullable(),
});
export type DeviceInterfaceInput = z.infer<typeof deviceInterfaceSchema>;
