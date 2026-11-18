// The guest's phone, for the menu's item detail (Part 8 Step 4): whether to
// hold back the 360° spin, how a drag turns it, and the "Lighter menu"
// choice. Pure — the browser passes in what it knows.

export type DeviceHints = {
  connection?: { saveData?: boolean; effectiveType?: string } | null;
  deviceMemory?: number;
  hardwareConcurrency?: number;
};

// A slow phone or connection: the guest asked to save data, a 2G/3G link,
// 2 GB of memory or less, or 2 cores or fewer. The spin then waits for a tap.
export function isSlowDevice(hints: DeviceHints): boolean {
  const c = hints.connection;
  if (c?.saveData) return true;
  if (c?.effectiveType && ["slow-2g", "2g", "3g"].includes(c.effectiveType)) return true;
  if (typeof hints.deviceMemory === "number" && hints.deviceMemory > 0 && hints.deviceMemory <= 2) return true;
  if (typeof hints.hardwareConcurrency === "number" && hints.hardwareConcurrency > 0 && hints.hardwareConcurrency <= 2) return true;
  return false;
}

// A drag turns the spin a frame for every few pixels: dragging left turns
// it forward. Position is in frames (fractional while moving); the frame
// shown wraps round the set.
export const PX_PER_FRAME = 8;
export const frameAt = (position: number, count: number) => (count > 0 ? ((Math.round(position) % count) + count) % count : 0);
export const dragTo = (startPosition: number, dxPx: number) => startPosition - dxPx / PX_PER_FRAME;

// After the finger lifts it keeps turning, slowing each animation frame,
// until it's barely moving. Velocity in frames per millisecond.
export const INERTIA_DECAY = 0.92;
export const INERTIA_STOP = 0.002;
export function inertia(position: number, velocity: number, ms = 16): { position: number; velocity: number; done: boolean } {
  const next = velocity * INERTIA_DECAY;
  return { position: position + velocity * ms, velocity: next, done: Math.abs(next) < INERTIA_STOP };
}

// "Lighter menu": no 360° or 3D on this phone. Remembered on the phone only;
// a phone that won't store it (private browsing) just forgets.
export const LIGHTER_KEY = "ringz.menu.lighter";
type Store = { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void };
export function readLighter(store: Store | null | undefined): boolean {
  try {
    return store?.getItem(LIGHTER_KEY) === "1";
  } catch {
    return false;
  }
}
export function writeLighter(store: Store | null | undefined, on: boolean): void {
  try {
    if (on) store?.setItem(LIGHTER_KEY, "1");
    else store?.removeItem(LIGHTER_KEY);
  } catch {
    // Not stored: it lasts until the page closes.
  }
}

// The choice as a tiny store for useSyncExternalStore: read from the phone;
// changed here or in another tab of the menu.
const CHANGED = "ringz-menu-lighter";
// What this page last chose, for a phone that won't store it.
let chosen: boolean | null = null;
export const lighterStore = {
  subscribe(onChange: () => void): () => void {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== LIGHTER_KEY) return;
      chosen = null;
      onChange();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(CHANGED, onChange);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(CHANGED, onChange);
    };
  },
  get: (): boolean => chosen ?? readLighter(typeof window === "undefined" ? null : window.localStorage),
  // On the server, and before the phone is asked: off.
  getServer: (): boolean => false,
  set(on: boolean): void {
    chosen = on;
    writeLighter(window.localStorage, on);
    window.dispatchEvent(new Event(CHANGED));
  },
};
