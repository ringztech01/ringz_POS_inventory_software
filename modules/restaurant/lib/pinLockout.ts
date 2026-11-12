// PIN sign-in guessing, held back per device (Part 6f Step 4): five wrong
// PINs in a row lock the device for 30 seconds; each lock after that is
// longer — 60 s, 2 minutes, then 5 minutes at most. A right PIN starts it
// all over; so does a quiet spell (a quarter of an hour since the last lock
// ended). Pure: the service keeps the numbers on the Device row.

export const PIN_SIGNIN_TRIES = 5;
export const LOCK_STEPS_SECONDS = [30, 60, 120, 300] as const;
// After this long without a lock, the next one is the short one again.
export const LOCK_FORGET_MS = 15 * 60_000;

export type GuessState = { failures: number; lockedUntil: Date | null; lockLevel: number };

export function lockSeconds(level: number): number {
  return LOCK_STEPS_SECONDS[Math.max(0, Math.min(level, LOCK_STEPS_SECONDS.length - 1))];
}

// Seconds the device still waits (0: it doesn't).
export function lockedFor(state: GuessState, now: Date): number {
  if (!state.lockedUntil) return 0;
  const left = state.lockedUntil.getTime() - now.getTime();
  return left > 0 ? Math.ceil(left / 1000) : 0;
}

// A wrong PIN: counted; the fifth locks the device (`locked`: for how long).
// The lock's end is kept afterwards — it's how a quiet spell is told apart.
export function afterWrong(state: GuessState, now: Date): GuessState & { locked: number | null } {
  const forgotten = state.lockedUntil !== null && now.getTime() - state.lockedUntil.getTime() > LOCK_FORGET_MS;
  const level = forgotten ? 0 : state.lockLevel;
  const failures = state.failures + 1;
  if (failures < PIN_SIGNIN_TRIES) return { failures, lockedUntil: state.lockedUntil, lockLevel: level, locked: null };
  const seconds = lockSeconds(level);
  return { failures: 0, lockedUntil: new Date(now.getTime() + seconds * 1000), lockLevel: level + 1, locked: seconds };
}

export const afterRight = (): GuessState => ({ failures: 0, lockedUntil: null, lockLevel: 0 });

// "30 seconds", "1:45", "5:00".
export function waitLabel(seconds: number): string {
  if (seconds < 60) return `${seconds} ${seconds === 1 ? "second" : "seconds"}`;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export const waitText = (seconds: number) => `Too many attempts · wait ${waitLabel(seconds)}`;
