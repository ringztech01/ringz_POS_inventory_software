import type { DrawerReason } from "@prisma/client";
import { EscPos } from "./escpos";

// The cash drawer — pure (the print worker and the tests import it; the
// service is drawer.ts). A drawer is plugged into a receipt printer's RJ11
// port; the printer opens it on ESC p (pin 2 or 5). Its kick goes through
// the print queue as a DRAWER job: ahead of any tickets waiting on that
// printer, never moved to a fallback (the drawer is on this printer), and
// dropped when the printer hasn't taken it within DRAWER_TTL_MS — a drawer
// never springs open minutes later with nobody at the till.

export const DRAWER_TTL_MS = 30_000;
export const DRAWER_NOTE_MAX = 140;

export const DRAWER_REASON_LABEL: Record<DrawerReason, string> = {
  CASH_SALE: "Cash sale",
  CASH_REFUND: "Cash refund",
  MANUAL: "Opened by hand",
  TEST: "Test",
};

// Quick picks for Open drawer's reason (any text will do).
export const DRAWER_QUICK_REASONS = ["Give change", "Count the float", "Cash pick-up", "Fix wrong change"] as const;

// What's sent: initialise, then the kick on the printer's pin. No paper moves.
export function drawerBytes(pin: number): Uint8Array {
  return new EscPos().kickDrawer(pin === 5 ? 5 : 2).bytes();
}

// Cash changed hands: some cash payment above zero.
export function tookCash(payments: readonly { paymentType: string; amount: string | number }[]): boolean {
  return payments.some((p) => p.paymentType === "CASH" && Number(p.amount) > 0);
}

// How a drawer event went, from its kick's print job.
export function drawerOutcome(status: string): { label: string; tone: "ok" | "wait" | "bad" } {
  if (status === "DONE") return { label: "Opened", tone: "ok" };
  if (status === "QUEUED" || status === "PRINTING") return { label: "Sending…", tone: "wait" };
  if (status === "CANCELLED") return { label: "Not opened", tone: "bad" };
  return { label: "Failed", tone: "bad" };
}
