import { z } from "zod";

export const brandSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(150),
});

export type BrandInput = z.infer<typeof brandSchema>;
