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

// For date-only values (stored anchored at UTC midnight): formats the UTC
// calendar day as MM/DD/YYYY, so the server's timezone can never shift it.
export function formatDateOnly(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function getInitials(firstName: string, lastName: string): string {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}

// Also accepts a decimal string (e.g. a Prisma Decimal's toString()), which
// Intl formats exactly — no round-trip through a float.
export function formatNaira(amount: number | string): string {
  const value = typeof amount === "string" ? (amount as Intl.StringNumericLiteral) : amount;
  return `₦${new Intl.NumberFormat("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`;
}
