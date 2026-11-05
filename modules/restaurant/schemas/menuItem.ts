import { z } from "zod";
import { idSchema } from "./common";

export const MENU_CODE_MAX = 30;
export const MENU_NAME_MAX = 80;
export const MENU_DESCRIPTION_MAX = 500;

// A menu item (Food › Menu items). The price is the item's own list price;
// order lines keep their own snapshot of it (Part 3). Code uniqueness is
// checked server-side — Product codes are unique across every product.
export const menuItemSchema = z.object({
  code: z
    .string({ message: "Code is required." })
    .trim()
    .min(1, "Code is required.")
    .max(MENU_CODE_MAX, `Code can be at most ${MENU_CODE_MAX} characters.`)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "Use letters, numbers, dots, dashes or underscores."),
  name: z
    .string({ message: "Name is required." })
    .trim()
    .min(1, "Name is required.")
    .max(MENU_NAME_MAX, `Name can be at most ${MENU_NAME_MAX} characters.`),
  categoryId: z.string({ message: "Choose a category." }).trim().min(1, "Choose a category."),
  price: z
    .string({ message: "Price is required." })
    .trim()
    .min(1, "Price is required.")
    .regex(/^\d{1,9}(\.\d{1,2})?$/, "Enter a price like 18 or 18.50.")
    .refine((value) => Number(value) > 0, "Price must be more than 0."),
  description: z
    .string()
    .trim()
    .max(MENU_DESCRIPTION_MAX, `Description can be at most ${MENU_DESCRIPTION_MAX} characters.`)
    .transform((value) => value || null),
  // "" = no station: lines go to the first active station (Part 4).
  stationId: z
    .string()
    .trim()
    .transform((value) => value || null),
});

export type MenuItemInput = z.infer<typeof menuItemSchema>;
export type MenuItemField = keyof z.input<typeof menuItemSchema>;

// The list's switches: Available / On menu, saved straight away.
export const menuItemFlagSchema = z.object({
  id: idSchema,
  field: z.enum(["isAvailable", "showOnMenu"]),
  value: z.boolean(),
});

// Food › Menu items › Modifiers: a group on or off a menu item, saved straight away.
export const itemGroupSchema = z.object({ productId: idSchema, groupId: idSchema, attached: z.boolean() });
