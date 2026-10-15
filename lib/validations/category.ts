import { z } from "zod";

export const categorySchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(150),
});

export type CategoryInput = z.infer<typeof categorySchema>;
