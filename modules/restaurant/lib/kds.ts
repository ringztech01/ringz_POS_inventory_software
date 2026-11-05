import type { KitchenStatus } from "@prisma/client";
import { readModifiers } from "./orderLines";

// The kitchen display's and KOTs' pure rules. Line states are Part 3's
// (KitchenStatus): New → Sent (PENDING) → Preparing → Ready → Served; a
// cancelled line is one with cancelledAt set.

// KOT-000123.
export function kotRef(number: number): string {
  return `KOT-${String(number).padStart(6, "0")}`;
}

// The modifiers on a KOT line: "Large · Extra plantain" (null with none).
export function modifiersText(json: unknown): string | null {
  const names = readModifiers(json).map((m) => m.name);
  return names.length ? names.join(" · ") : null;
}

// Where a line goes: its dish's station while that station is active, else
// the first active station (in station order). null: none is active.
export function stationFor(productStationId: string | null, active: readonly { id: string }[]): string | null {
  if (productStationId && active.some((s) => s.id === productStationId)) return productStationId;
  return active[0]?.id ?? null;
}

type TicketLine = { kitchenStatus: KitchenStatus; cancelledAt: Date | null; deletedAt: Date | null };

// A ticket is bumped (done) when every live line on it is Ready or Served.
// One with no live lines left (all cancelled) counts as done too.
export function isTicketDone(lines: readonly TicketLine[]): boolean {
  return lines.every((line) => line.cancelledAt !== null || line.deletedAt !== null || line.kitchenStatus === "READY" || line.kitchenStatus === "SERVED");
}

// "Sent 3 to Kitchen and 1 to Bar."
export function sentMessage(sent: readonly { station: string; count: number }[]): string | null {
  const parts = sent.filter((s) => s.count > 0).map((s) => `${s.count} to ${s.station}`);
  if (parts.length === 0) return null;
  return `Sent ${parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0]}.`;
}

// ---- The kitchen's steps ---------------------------------------------------
// The kitchen moves a line Sent (PENDING) → Preparing → Ready, and can step
// back Ready → Preparing → Sent. New lines never reach it; only waiters set
// Served (from the order screen).

export type KitchenStep = "PENDING" | "PREPARING" | "READY";
export const KITCHEN_STEPS: readonly KitchenStep[] = ["PENDING", "PREPARING", "READY"];

export function nextStep(from: KitchenStep): KitchenStep | null {
  return from === "PENDING" ? "PREPARING" : from === "PREPARING" ? "READY" : null;
}

export function previousStep(from: KitchenStep): KitchenStep | null {
  return from === "READY" ? "PREPARING" : from === "PREPARING" ? "PENDING" : null;
}

type StepTimes = { startedAt?: Date | null; readyAt?: Date | null };

// Times set on entering a step: Preparing starts the cook; Ready ends it
// (and starts it too, for a line that went straight to Ready).
export function timesEntering(to: KitchenStep, now: Date, startedAt: Date | null): StepTimes {
  if (to === "PREPARING") return { startedAt: now };
  if (to === "READY") return startedAt ? { readyAt: now } : { startedAt: now, readyAt: now };
  return {};
}

// Times cleared on stepping back to `to`.
export function timesSteppingBackTo(to: KitchenStep): StepTimes {
  if (to === "PREPARING") return { readyAt: null };
  if (to === "PENDING") return { startedAt: null, readyAt: null };
  return {};
}

// A ticket's age as "mm:ss" (minutes past 99 keep counting: "123:05").
export function fmtElapsed(from: Date | string | number, now: Date | number): string {
  const seconds = Math.max(0, Math.floor((new Date(now).getTime() - new Date(from).getTime()) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

// Past its station's limit (and not finished).
export function isLate(sentAt: Date | string, lateAfterMin: number, now: Date | number): boolean {
  return new Date(now).getTime() - new Date(sentAt).getTime() > lateAfterMin * 60_000;
}

// The board's filters, from the URL: ?station=<code> (unknown → All) and
// ?view=active|done.
export type KdsView = "active" | "done";
export function readKdsFilter(params: { station?: string; view?: string }, codes: readonly string[]): { station: string | null; view: KdsView } {
  const code = params.station?.toUpperCase();
  return { station: code && codes.includes(code) ? code : null, view: params.view === "done" ? "done" : "active" };
}
