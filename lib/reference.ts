// Generates short, human-readable document reference numbers (e.g.
// ADJ_LZ3KFQR9), shared by any module that needs one — Adjustments now,
// Purchases/Sales/Transfers later. Not sequential; collisions are
// astronomically unlikely, and a unique constraint on the caller's column is
// the real safety net.
export function generateReference(prefix: string): string {
  const time = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${prefix}_${time}${random}`;
}
