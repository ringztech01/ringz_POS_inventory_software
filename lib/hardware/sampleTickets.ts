import type { KotTicket, PrebillTicket, ReceiptTicket } from "./tickets";

// Made-up tickets for the Settings preview (never printed).

export const SAMPLE_KOT: KotTicket = {
  ref: "KOT-000123",
  type: "NEW",
  note: null,
  station: "Kitchen",
  table: "T4",
  orderRef: "ORD-0142",
  orderType: "Dine-in",
  area: "Main hall",
  guests: 3,
  waiter: "Ada",
  createdAt: "2026-11-05T12:30:00.000Z",
  lines: [
    { quantity: 2, name: "Jollof Rice & Chicken", modifiers: "Large · Extra plantain", note: "no pepper", amount: "₦9,000.00" },
    { quantity: 1, name: "Pepper Soup (Goat)", modifiers: null, note: null, amount: "₦3,500.00" },
    { quantity: 3, name: "Chapman", modifiers: "No ice", note: null, amount: "₦4,500.00" },
  ],
  items: 6,
};

export const SAMPLE_VOID_KOT: KotTicket = { ...SAMPLE_KOT, ref: "KOT-000124", type: "VOID", note: "VOID: Wrong item", lines: [SAMPLE_KOT.lines[1]], items: 1 };

export const SAMPLE_PREBILL: PrebillTicket = {
  company: { name: "RingzPOS", address: "", phone: "" },
  table: "T4",
  ref: "ORD-0142",
  orderType: "Dine-in",
  waiter: "Ada",
  guests: 3,
  printedAt: "2026-11-05T13:05:00.000Z",
  lines: [
    { quantity: 2, name: "Jollof Rice & Chicken", amount: "₦9,000.00", modifiers: [{ name: "Large", price: "+₦500.00" }], note: null },
    { quantity: 1, name: "Pepper Soup (Goat)", amount: "₦3,500.00", modifiers: [], note: null },
    { quantity: 3, name: "Chapman", amount: "₦4,500.00", modifiers: [], note: null },
  ],
  totals: [
    ["Sub total", "₦17,000.00"],
    ["Service charge (10%)", "₦1,700.00"],
    ["Tax", "₦0.00"],
  ],
  total: "₦18,700.00",
  split: null,
};

export const SAMPLE_RECEIPT: ReceiptTicket = {
  title: "RingzPOS",
  place: "Main Office",
  reference: "SL_0142",
  date: "05/11/2026",
  customer: "Walk-in customer",
  details: [
    ["Order", "ORD-0142"],
    ["Table", "T4"],
    ["Waiter", "Ada"],
  ],
  items: [
    { name: "Jollof Rice & Chicken", quantity: 2, unitCost: "₦4,500.00", subtotal: "₦9,000.00" },
    { name: "Pepper Soup (Goat)", quantity: 1, unitCost: "₦3,500.00", subtotal: "₦3,500.00" },
    { name: "Chapman", quantity: 3, unitCost: "₦1,500.00", subtotal: "₦4,500.00" },
  ],
  totals: [
    ["Order tax (0%)", "₦0.00"],
    ["Discount", "₦0.00"],
    ["Service charge", "₦1,700.00"],
  ],
  grandTotal: "₦18,700.00",
  payments: [["Paid · Cash", "₦20,000.00"]],
  due: "₦0.00",
  status: "Paid",
  afterPayments: [],
  footer: "Thank you for your purchase.",
};
