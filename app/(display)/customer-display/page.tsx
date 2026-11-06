import type { Metadata } from "next";
import CustomerDisplay from "@/components/hardware/CustomerDisplay";
import { loadTicketLook } from "@/lib/hardware/ticketLook";

export const metadata: Metadata = { title: "Customer display — RingzPOS" };

// /customer-display — open on the till's second screen, in the same browser
// as the POS: it shows the customer their cart, total and change (a stub;
// lib/hardware/customerDisplay.ts). The name is the receipts' header line.
export default async function CustomerDisplayPage() {
  const look = await loadTicketLook();
  return <CustomerDisplay business={look.header[0] ?? "RingzPOS"} />;
}
