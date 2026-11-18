// An amount in kobo written the way the menu writes its prices: "₦1,500.00"
// or "NGN 1,500.00" (the menu's currency display, read off a price it
// shows). For the guest's running totals only — the server prices orders.
export function menuMoney(kobo: number, sample: string | null): string {
  const number = new Intl.NumberFormat("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(kobo / 100);
  return sample?.startsWith("NGN") ? `NGN ${number}` : `₦${number}`;
}
