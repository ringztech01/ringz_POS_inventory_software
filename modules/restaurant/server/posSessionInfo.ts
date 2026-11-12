import "server-only";
import type { CurrentUserPermissions } from "@/lib/auth/permissions.server";
import { pinTerminalId } from "@/lib/auth/pinTerminal";
import type { PosSettings } from "./queries/posScreen";
import { shiftStatus } from "./services/shifts";

// What the touch POS's session needs (Part 6f Step 6): is this a PIN
// terminal (LOCK ends the session there), the person's shift (clock in /
// out), and their auto-lock — service staff's time, or Managers' and the
// Administrator's; never, when the service setting is Never.
export type PosSessionInfo = { terminal: boolean; shift: { clockOn: boolean; onShift: boolean }; lockSeconds: number; training: boolean };

export async function getPosSessionInfo(current: CurrentUserPermissions, settings: PosSettings): Promise<PosSessionInfo> {
  const [terminal, shift] = await Promise.all([
    pinTerminalId(),
    current.userId ? shiftStatus(current.userId).catch(() => null) : null,
  ]);
  const lockSeconds = settings.lockSeconds === 0 ? 0 : current.serviceOnly ? settings.lockSeconds : settings.lockSecondsManager;
  return { terminal: !!terminal, shift: { clockOn: shift?.clockOn ?? false, onShift: shift?.state === "ON" }, lockSeconds, training: current.training };
}
