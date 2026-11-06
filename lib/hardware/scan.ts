// Barcode scanners are keyboards: a scan is the code typed very fast, then
// Enter. Pure (the listener is components/hardware/ScanProvider.tsx; the
// tests are in hardware.test.ts). A run of characters with every gap — and
// the one before Enter — at most `maxGapMs`, and at least `minLength` long,
// is a scan; anything slower is a person typing. Each device tunes its own
// limits on Settings › Scanner test (kept in that browser).

export type ScanSettings = { maxGapMs: number; minLength: number };
export const DEFAULT_SCAN: ScanSettings = { maxGapMs: 50, minLength: 4 };
export const SCAN_LIMITS = { maxGapMs: [10, 300], minLength: [1, 30] } as const;
// A pause this long starts a new attempt (the test page shows each attempt).
const RESET_MS = 1000;
const MAX_CODE = 128;

export type ScanAttempt = {
  code: string;
  // From the first character to Enter.
  durationMs: number;
  // Between characters, and from the last one to Enter.
  gaps: number[];
  slowestGapMs: number;
  averageGapMs: number;
  accepted: boolean;
  // Why it wasn't a scan (null when it was).
  reason: string | null;
};

export function clampScanSettings(s: Partial<ScanSettings> | null | undefined): ScanSettings {
  const num = (v: unknown, [lo, hi]: readonly [number, number], fallback: number) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
  };
  return {
    maxGapMs: num(s?.maxGapMs, SCAN_LIMITS.maxGapMs, DEFAULT_SCAN.maxGapMs),
    minLength: num(s?.minLength, SCAN_LIMITS.minLength, DEFAULT_SCAN.minLength),
  };
}

export class ScanDetector {
  private chars: { ch: string; t: number }[] = [];

  constructor(public settings: ScanSettings = DEFAULT_SCAN) {}

  reset(): void {
    this.chars = [];
  }

  // A key pressed at time t (ms). Enter ends an attempt and answers it; other
  // printable keys are collected; Shift and friends are ignored.
  key(key: string, t: number): ScanAttempt | null {
    if (key === "Enter") {
      const chars = this.chars;
      this.chars = [];
      if (chars.length === 0) return null;
      return this.judge(chars, t);
    }
    if (key.length !== 1) return null;
    const last = this.chars.at(-1);
    if (last && t - last.t > RESET_MS) this.chars = [];
    if (this.chars.length < MAX_CODE) this.chars.push({ ch: key, t });
    return null;
  }

  private judge(chars: { ch: string; t: number }[], enterAt: number): ScanAttempt {
    const times = [...chars.map((c) => c.t), enterAt];
    const gaps = times.slice(1).map((t, i) => Math.max(0, Math.round(t - times[i])));
    const slowest = Math.max(...gaps);
    const average = Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length);
    const code = chars.map((c) => c.ch).join("").trim();
    const { maxGapMs, minLength } = this.settings;
    const reason =
      code.length < minLength
        ? `Too short: ${code.length} character${code.length === 1 ? "" : "s"} (at least ${minLength}).`
        : slowest > maxGapMs
          ? `Too slow for a scanner: a ${slowest} ms gap (the limit is ${maxGapMs} ms).`
          : null;
    return { code, durationMs: Math.round(enterAt - chars[0].t), gaps, slowestGapMs: slowest, averageGapMs: average, accepted: reason === null, reason };
  }
}

// A limit that suits a scanner whose slowest gap was `slowest` ms: twice it
// plus 10 ms of headroom, but well under human typing (~100 ms+).
export function suggestedMaxGap(slowest: number): number {
  return clampScanSettings({ maxGapMs: Math.min(80, slowest * 2 + 10) }).maxGapMs;
}

// Text fields keep their keys: a scan into one is that field's business
// (POS's search box already adds the product on Enter).
export function isTextEntry(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if ((el as HTMLElement).isContentEditable) return true;
  if (tag !== "INPUT") return false;
  const type = ((el as HTMLInputElement).type || "text").toLowerCase();
  return !["button", "checkbox", "radio", "range", "reset", "submit", "image", "color", "file"].includes(type);
}
