// Runs once when the Next.js server starts (next dev / next start): starts
// the hardware bridge for printers, drawers and scanners
// (lib/hardware/bridgeLauncher.ts) and the print queue's worker
// (lib/hardware/printWorker.ts). Node.js runtime only, and not while
// building.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
  const { startBridge } = await import("./lib/hardware/bridgeLauncher");
  startBridge();
  const { startPrintWorker } = await import("./lib/hardware/printWorker");
  void startPrintWorker().catch((error: unknown) => console.error("[print] worker didn't start:", error));
}
