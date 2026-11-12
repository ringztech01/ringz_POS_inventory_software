// Staff PINs (Part 6f Step 3): exactly 4 digits, unique in the business, and
// not easy to guess — unless an Administrator allows weak ones. Stored as a
// bcrypt hash only; a generated one is shown once.

export const PIN_LENGTH = 4;
export const PIN_DIGITS = /^\d{4}$/;

// Easy to guess: the classics, one digit repeated, a run up or down the
// digits (0123, 9876, 8901 wraps too), two digits taking turns (1212), and
// a keypad's middle column (2580, 0852).
const CLASSICS = new Set(["1234", "0000", "1111", "2580", "0852", "1212", "6969", "1004", "2000", "4321"]);

export function weakPinReason(pin: string): string | null {
  if (CLASSICS.has(pin)) return "one of the PINs people guess first";
  const d = [...pin].map(Number);
  if (d.every((x) => x === d[0])) return "the same digit repeated";
  const steps = d.slice(1).map((x, i) => (x - d[i] + 10) % 10);
  if (steps.every((s) => s === 1) || steps.every((s) => s === 9)) return "digits in a row";
  if (d[0] === d[2] && d[1] === d[3]) return "a repeating pattern";
  return null;
}

// Why this PIN can't be used (before checking it's free), or null.
export function pinProblem(pin: string, options: { allowWeak: boolean }): string | null {
  if (!PIN_DIGITS.test(pin)) return `A PIN is ${PIN_LENGTH} digits.`;
  const weak = options.allowWeak ? null : weakPinReason(pin);
  return weak ? `That PIN is too easy to guess (${weak}). Pick another.` : null;
}

// A random PIN that passes the rules and isn't taken (`taken` checks).
export async function generatePin(taken: (pin: string) => Promise<boolean>, random: () => number, tries = 50): Promise<string | null> {
  for (let i = 0; i < tries; i++) {
    const pin = String(Math.floor(random() * 10_000)).padStart(PIN_LENGTH, "0");
    if (weakPinReason(pin)) continue;
    if (!(await taken(pin))) return pin;
  }
  return null;
}

// "Ada Okafor" → "Ada O." (on tickets, unless they've their own).
export function defaultDisplayName(firstName: string, lastName: string): string {
  const initial = lastName.trim().charAt(0).toUpperCase();
  return initial ? `${firstName.trim()} ${initial}.` : firstName.trim();
}

// PIN-only staff (added in Settings › Staff) have a placeholder login
// nobody knows — the email/password sign-in can't be used for them.
export const PIN_ONLY_DOMAIN = "pin.local";
export const isPinOnlyEmail = (email: string) => email.toLowerCase().endsWith(`@${PIN_ONLY_DOMAIN}`);

// Colours for staff on the POS (initials badges).
export const STAFF_COLOURS = ["#0F7D6A", "#2457A6", "#C2611A", "#6B3FA0", "#B3261E", "#13804A", "#8A5A00", "#3A424C"] as const;
