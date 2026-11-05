import { z } from "zod";

// A record id sent by the browser (actions re-read the record by it).
export const idSchema = z.string().trim().min(1).max(191);
