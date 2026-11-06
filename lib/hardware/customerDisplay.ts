// The customer display — a stub (Part 6d Step 6). The POS tells it what the
// customer should see; /pos/display (open it on the till's second screen, in
// the same browser) shows it. They talk over a BroadcastChannel, so nothing
// leaves the device. A pole display (a 2 × 20 character VFD on a serial
// port) would show poleDisplayLines(); sending those through the hardware
// bridge is for later.

export const CUSTOMER_DISPLAY_CHANNEL = "ringz-customer-display";

export type DisplayLine = { name: string; quantity: number; total: string };
export type DisplayMessage =
  | { kind: "idle" }
  | { kind: "cart"; lines: DisplayLine[]; total: string }
  | { kind: "done"; total: string; paid: string; change: string };

export const POLE_WIDTH = 20;

// Two lines of 20 for a pole display: the latest item and the total.
export function poleDisplayLines(message: DisplayMessage): [string, string] {
  const fit = (left: string, right = "") => {
    const room = POLE_WIDTH - right.length - (right ? 1 : 0);
    const l = left.length > room ? left.slice(0, Math.max(0, room)) : left;
    return right ? `${l.padEnd(room)} ${right}`.slice(0, POLE_WIDTH) : l.padEnd(POLE_WIDTH).slice(0, POLE_WIDTH);
  };
  if (message.kind === "idle") return [fit("Welcome!"), fit("")];
  if (message.kind === "done") return [fit("Change", message.change), fit("Thank you!")];
  const last = message.lines.at(-1);
  return [last ? fit(`${last.quantity}x ${last.name}`, last.total) : fit("Welcome!"), fit("Total", message.total)];
}

// Posts to the display, if this browser can (never throws).
export function postToCustomerDisplay(message: DisplayMessage): void {
  try {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(CUSTOMER_DISPLAY_CHANNEL);
    channel.postMessage(message);
    channel.close();
  } catch {
    // No display: nothing to do.
  }
}
