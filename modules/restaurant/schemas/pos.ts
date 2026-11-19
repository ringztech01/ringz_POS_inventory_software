import { z } from "zod";
import { drawerOpenSchema } from "@/lib/validations/drawer";
import { pinSchema } from "./bill";
import { idSchema } from "./common";

// The touch POS (Part 6e Step 5): new takeaways and bar tabs, the waiter
// switch, and its settings.

export const TAB_NAME_MAX = 40;

// Takeaway, or a bar tab with its name ("Ada — blue shirt").
export const newPosOrderSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("TAKEAWAY") }),
  z.object({
    type: z.literal("BAR_TAB"),
    tabName: z.string({ message: "Give the tab a name." }).trim().min(1, "Give the tab a name.").max(TAB_NAME_MAX, `A tab name can be at most ${TAB_NAME_MAX} characters.`),
  }),
]);
export type NewPosOrderInput = z.output<typeof newPosOrderSchema>;

// Open drawer on the touch POS: a reason, and a manager's PIN for someone
// without Open Drawer.
export const posDrawerSchema = drawerOpenSchema.extend({ managerApproval: z.object({ approverId: idSchema, pin: pinSchema }).optional() });

// A waiter taps their name and types their PIN.
// No userId: "your PIN logs you in, no name needed" (PIN Login design).
export const posSwitchSchema = z.object({ userId: idSchema.optional(), pin: pinSchema });

// Auto-lock after this many seconds without a tap (0: never).
export const LOCK_CHOICES = [0, 30, 60, 120, 300] as const;
export const MANAGER_LOCK_CHOICES = [60, 120, 300, 600, 900] as const;

export const posSettingsSchema = z.object({
  returnHome: z.boolean(),
  sendToFloor: z.boolean(),
  lockSeconds: z.number().refine((n): n is (typeof LOCK_CHOICES)[number] => (LOCK_CHOICES as readonly number[]).includes(n), "Pick one of the times."),
  // Managers and the Administrator (Part 6f Step 6): never 0 — "never" is
  // the service setting's (it turns auto-lock off for everyone).
  lockSecondsManager: z.number().refine((n): n is (typeof MANAGER_LOCK_CHOICES)[number] => (MANAGER_LOCK_CHOICES as readonly number[]).includes(n), "Pick one of the times."),
  // The light theme instead of the dark frame (every till).
  lightTheme: z.boolean(),
  // The tablet Order screen's item columns (Part 6g Step 5).
  tabletColumns: z.union([z.literal(2), z.literal(3), z.literal(4)], { message: "Pick 2, 3 or 4 columns." }),
  // Keep a tablet's screen on while the app is open (Part 6g Step 6).
  tabletWakeLock: z.boolean(),
});
export type PosSettingsInput = z.output<typeof posSettingsSchema>;
