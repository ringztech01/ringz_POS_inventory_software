import type { TaxType } from "@prisma/client";

// A product card on the POS grid, and what the cart needs to price a line
// with lib/pricing.ts (Step 2). Money is a Decimal string.
export type PosProduct = {
  id: string;
  code: string;
  name: string;
  price: string;
  taxType: TaxType;
  // Product tax %, as a Decimal string ("0" when none).
  orderTax: string;
  unitName: string;
  categoryId: string;
  brandId: string;
  image: string | null;
  // ProductStock.quantity in the selected warehouse (0 without a row).
  stock: number;
};

export type PosOption = { id: string; name: string };
