// The emergency recovery code (Part 6f Step 4): for when every
// Administrator's PIN (or password) is lost. 20 characters from Crockford's
// base-32 alphabet (no I, L, O or U — nothing to misread), about 100 bits,
// shown once in groups of five: "7KQ2M-W9XD4-…". Typed back, case, spaces
// and dashes don't matter, and O / I / L are read as 0 / 1 / 1. Pure; the
// bytes come from the caller (node:crypto randomBytes).

export const RECOVERY_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const RECOVERY_LENGTH = 20;

export function recoveryCodeFrom(bytes: Uint8Array): string {
  if (bytes.length < RECOVERY_LENGTH) throw new Error("A recovery code needs 20 random bytes.");
  let code = "";
  for (let i = 0; i < RECOVERY_LENGTH; i++) code += RECOVERY_ALPHABET[bytes[i] % 32];
  return formatRecoveryCode(code);
}

export function formatRecoveryCode(code: string): string {
  return code.match(/.{1,5}/g)?.join("-") ?? code;
}

// The code as typed → its 20 characters, or null if it can't be one.
export function normaliseRecoveryCode(typed: unknown): string | null {
  if (typeof typed !== "string" || typed.length > 60) return null;
  const plain = typed
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  if (plain.length !== RECOVERY_LENGTH) return null;
  for (const c of plain) if (!RECOVERY_ALPHABET.includes(c)) return null;
  return plain;
}
