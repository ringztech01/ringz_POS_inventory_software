// The printer badge's words (components/hardware/PrinterAlerts.tsx).
export type PrinterAlert = { printer: string; status: string | null; waiting: number; failed: number };

export function alertText(a: PrinterAlert): string {
  const state = a.status === "PAPER_OUT" ? "out of paper" : a.status === "OFFLINE" ? "offline" : null;
  if (state && a.waiting > 0) return `${a.printer} ${state} (${a.waiting} waiting)${a.failed ? ` · ${a.failed} failed` : ""}`;
  return `${a.printer}: ${a.failed} failed`;
}
