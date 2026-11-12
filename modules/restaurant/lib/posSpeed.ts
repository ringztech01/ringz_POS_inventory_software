import type { OrderCourse } from "@prisma/client";

// The touch POS's speed tools (Part 6e Step 4): seats and courses, held
// courses, Send by course, and dishes found by code. Pure.

export type Course = OrderCourse;
export const COURSES: readonly Course[] = ["STARTER", "MAIN", "DESSERT"];
export const COURSE_LABEL: Record<Course, string> = { STARTER: "Starter", MAIN: "Main", DESSERT: "Dessert" };

// "Seat 2 · Main", "Seat 2", "Main", "" — on the check and the kitchen ticket.
export function placeLabel(seat: number | null, course: Course | null): string {
  return [seat ? `Seat ${seat}` : "", course ? COURSE_LABEL[course] : ""].filter(Boolean).join(" · ");
}

// The kitchen ticket's note for a line: its place, then the waiter's note.
export function kitchenNote(seat: number | null, course: Course | null, note: string | null): string | null {
  return [placeLabel(seat, course), note ?? ""].filter(Boolean).join(" — ") || null;
}

type SendLine = { id: string; course: Course | null; held: boolean; waiting: boolean };

// What Send offers: every waiting line not held, and each course's (in
// course order; lines with no course aren't a course of their own).
// `waiting`: New and counted.
export function sendChoices(lines: readonly SendLine[]): { all: string[]; courses: { course: Course; lineIds: string[] }[] } {
  const ready = lines.filter((l) => l.waiting && !l.held);
  return {
    all: ready.map((l) => l.id),
    courses: COURSES.map((course) => ({ course, lineIds: ready.filter((l) => l.course === course).map((l) => l.id) })).filter((c) => c.lineIds.length > 0),
  };
}

// Send with no choice to make: nothing held, and everything going — the
// waiting lines plus dishes still saving (`saving`: their courses) — in one
// course or none. Then Send goes straight away, queued behind the saves.
export function sendsInOneGo(lines: readonly SendLine[], saving: readonly (Course | null)[] = []): boolean {
  if (lines.some((l) => l.waiting && l.held)) return false;
  const going = [...lines.filter((l) => l.waiting).map((l) => l.course), ...saving];
  return going.length > 0 && new Set(going).size === 1;
}

// Held lines by course (no course: "Held"), for the Fire bar.
export function heldGroups(lines: readonly SendLine[]): { course: Course | null; lineIds: string[] }[] {
  const held = lines.filter((l) => l.waiting && l.held);
  return [...COURSES, null]
    .map((course) => ({ course, lineIds: held.filter((l) => l.course === course).map((l) => l.id) }))
    .filter((g) => g.lineIds.length > 0);
}

// A dish by the code typed on the keypad or scanned: its exact code (any
// case), else the one dish whose code's digits are the digits typed
// ("301" → DM-301). None or several: null.
export function findByCode<T extends { code: string }>(items: readonly T[], typed: string): T | null {
  const code = typed.trim().toLowerCase();
  if (!code) return null;
  const exact = items.find((i) => i.code.toLowerCase() === code);
  if (exact) return exact;
  if (!/^\d+$/.test(code)) return null;
  const byDigits = items.filter((i) => i.code.replace(/\D/g, "") === code || i.code.toLowerCase().endsWith(`-${code}`));
  return byDigits.length === 1 ? byDigits[0] : null;
}

// Quick search: name or code contains every word typed, best (name starts
// with it) first.
export function searchDishes<T extends { name: string; code: string }>(items: readonly T[], query: string, limit = 18): T[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const hits = items.filter((i) => words.every((w) => i.name.toLowerCase().includes(w) || i.code.toLowerCase().includes(w)));
  const first = words[0];
  return hits.sort((a, b) => Number(b.name.toLowerCase().startsWith(first)) - Number(a.name.toLowerCase().startsWith(first)) || a.name.localeCompare(b.name)).slice(0, limit);
}

// The Qty keypad's number: digits only, 1–99 as a quantity.
export function typeDigit(value: string, digit: string, max = 6): string {
  if (!/^\d$/.test(digit) || value.length >= max) return value;
  return value === "0" ? digit : value + digit;
}
export const asQuantity = (value: string) => {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 99 ? n : null;
};

// "Ada Okafor" → "AO" and "Ada O."; "System" → "S" and "System".
export function staffBadge(name: string): { initials: string; short: string } {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return { initials: "?", short: "" };
  return {
    initials: words.slice(0, 2).map((w) => w[0].toUpperCase()).join(""),
    short: words.length > 1 ? `${words[0]} ${words[words.length - 1][0].toUpperCase()}.` : words[0],
  };
}
