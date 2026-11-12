import type { Metadata } from "next";

export const metadata: Metadata = { title: "Cash-up — RingzPOS" };

// /pos/cash-up — a till's cash-up (Restaurant module only: a 404 while off).
export { default } from "@/modules/restaurant/pages/CashUpPage";
