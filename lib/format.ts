export function formatDateTime(date: Date): { time: string; date: string } {
  const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hour12: true }).format(date);
  const dateStr = new Intl.DateTimeFormat("en-US", { month: "2-digit", day: "2-digit", year: "numeric" }).format(date);
  return { time, date: dateStr };
}

// For pre-filling <input type="date">, which needs a plain "YYYY-MM-DD"
// string. Uses the UTC calendar fields (not local ones) since date-only
// values are stored anchored at UTC midnight — see parseDateOfBirth in
// app/(dashboard)/peoples/customers/actions.ts. Mixing UTC on one side of
// this round-trip and local-timezone methods on the other is what causes the
// date to silently shift by a day.
export function formatDateForInput(date: Date | null | undefined): string {
  if (!date) return "";
  return date.toISOString().slice(0, 10);
}
