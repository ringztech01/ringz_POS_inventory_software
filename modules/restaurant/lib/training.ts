// Training mode (Part 6f Step 7f): someone in training (Settings › Staff)
// works on the real floor, but their orders are TRAINING ones — nothing
// printed to or shown in the kitchen, no stock moved, no sale, payment or
// tip when settled (so nothing in the cash-up, reports or dashboards). They
// can't change a real order; anyone else may tidy up a training one.

export const TRAINING_LABEL = "TRAINING";
export const TRAINING_REAL_ORDER = "You're in training mode: this is a real order. Practise on a free table, a takeaway or a bar tab.";
export const TRAINING_NO_COUNTER_SALES = "You're in training mode: counter sales here are real. Practise on the restaurant's tables.";
