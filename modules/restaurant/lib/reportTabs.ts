// Restaurant Reports' tabs, in order. Each is a route under
// /restaurant/reports (Overview is the index); the filters ride along in the
// query string. Prep times keeps its own page (/restaurant/reports/prep-times).

export const REPORT_TABS = [
  { key: "overview", label: "Overview", href: "/restaurant/reports" },
  { key: "dishes", label: "By dish", href: "/restaurant/reports/dishes" },
  { key: "waiters", label: "By waiter", href: "/restaurant/reports/waiters" },
  { key: "tables", label: "By table", href: "/restaurant/reports/tables" },
  { key: "order-types", label: "By order type", href: "/restaurant/reports/order-types" },
  { key: "payments", label: "Payments & tips", href: "/restaurant/reports/payments" },
  { key: "waste", label: "Waste", href: "/restaurant/reports/waste" },
  { key: "voids", label: "Voids & discounts", href: "/restaurant/reports/voids" },
  { key: "shifts", label: "Shifts & cash-up", href: "/restaurant/reports/shifts" },
] as const;

export type ReportTabKey = (typeof REPORT_TABS)[number]["key"];

// The [tab] segment → its tab; Overview has no segment of its own.
export function reportTabFor(segment: string): (typeof REPORT_TABS)[number] | null {
  return REPORT_TABS.find((tab) => tab.key === segment && tab.key !== "overview") ?? null;
}

// The query string the filter bar writes, carried from tab to tab.
export const REPORT_FILTER_PARAMS = ["from", "to", "area", "waiter", "type", "station", "device"] as const;

// Keeps only the filters (no paging, sorting or a tab's own state).
export function filterQuery(params: URLSearchParams): string {
  const kept = new URLSearchParams();
  for (const key of REPORT_FILTER_PARAMS) {
    const value = params.get(key);
    if (value) kept.set(key, value);
  }
  const query = kept.toString();
  return query ? `?${query}` : "";
}

export const ORDER_TYPE_LABELS = { DINE_IN: "Dine-in", TAKEAWAY: "Takeaway", BAR_TAB: "Bar tab", DELIVERY: "Delivery" } as const;

// Day-start choices (minutes after midnight): 00:00 to 06:00, every 30.
export const DAY_START_CHOICES = Array.from({ length: 13 }, (_, i) => i * 30);

export const dayStartLabel = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

const dayFormat = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", year: "numeric" });

// A business day "YYYY-MM-DD" → "Wed 11 Nov 2026".
export const reportDayLabel = (day: string) => dayFormat.format(new Date(`${day}T00:00:00.000Z`)).replace(",", "");
