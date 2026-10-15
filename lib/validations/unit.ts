import { z } from "zod";

export const unitSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(150),
});

export type UnitInput = z.infer<typeof unitSchema>;
