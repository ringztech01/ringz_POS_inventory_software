import { z } from "zod";
import { idSchema } from "./common";

export const INGREDIENT_NAME_MAX = 60;
export const UNIT_NAME_MAX = 20;

// Add ingredient (Food › Recipes). Either an existing INGREDIENT product
// (ingredientId) or a new one by name, made on the spot with its unit and
// cost per unit. The quantity is per serving, a whole number of the
// ingredient's own unit — stock is counted in whole units, so ingredients
// are kept in small ones (250 g, not 0.25 kg). The server looks up costs
// itself.
export const recipeLineSchema = z
  .object({
    menuItemId: idSchema,
    ingredientId: z
      .string()
      .trim()
      .transform((value) => value || null),
    name: z.string().trim().max(INGREDIENT_NAME_MAX, `Name can be at most ${INGREDIENT_NAME_MAX} characters.`),
    unit: z.string().trim().max(UNIT_NAME_MAX, `Unit can be at most ${UNIT_NAME_MAX} characters.`),
    cost: z
      .string()
      .trim()
      .regex(/^(\d{1,9}(\.\d{1,2})?)?$/, "Enter a cost like 2.20, or leave it blank.")
      .transform((value) => value || null),
    quantity: z
      .string({ message: "Enter the quantity." })
      .trim()
      .regex(/^\d{1,6}$/, "Enter a whole number of the ingredient's unit, like 250 (for 250 g).")
      .refine((value) => Number(value) > 0, "The quantity must be more than 0."),
  })
  .refine((line) => line.ingredientId || line.name, { message: "Pick or type an ingredient.", path: ["name"] })
  // Only once a new ingredient's name is typed (that's when the Unit field shows).
  .refine((line) => line.ingredientId || !line.name || line.unit, { message: "Choose the new ingredient's unit.", path: ["unit"] });

export type RecipeLineInput = z.infer<typeof recipeLineSchema>;
export type RecipeLineField = keyof z.input<typeof recipeLineSchema>;
