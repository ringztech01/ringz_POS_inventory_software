import { z } from "zod";
import { DRAWER_NOTE_MAX } from "@/lib/hardware/drawerKick";

// Open drawer (by hand): why — required, kept in the drawer log.
export const drawerOpenSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1, "Say why you're opening the drawer.")
    .max(DRAWER_NOTE_MAX, `The reason can be at most ${DRAWER_NOTE_MAX} characters.`),
});
