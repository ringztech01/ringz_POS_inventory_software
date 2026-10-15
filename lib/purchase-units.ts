// Purchase-unit choices on a purchase line (the line modal's "Purchase unit").
// Kept free of server-only imports so client components and the zod schema in
// lib/validations/purchase.ts can share it.
export const PURCHASE_UNITS = ["Pic", "Piece", "Box"] as const;

export type PurchaseUnit = (typeof PURCHASE_UNITS)[number];
