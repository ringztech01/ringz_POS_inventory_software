import { z } from "zod";
import { KITCHEN_STEPS, type KitchenStep } from "../lib/kds";
import { idSchema } from "./common";

// The kitchen display's actions. A line change carries the step the screen
// showed (`from`); a different one in the DB means another screen got there
// first.

const step = z.enum(KITCHEN_STEPS as [KitchenStep, ...KitchenStep[]]);

export const kitchenLineSchema = z.object({ itemId: idSchema, from: step });
export const kitchenTicketSchema = z.object({ kotId: idSchema });
