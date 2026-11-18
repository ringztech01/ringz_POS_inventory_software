import { addToBasket, readBasket, type BasketLine } from "../../lib/guestOrdering";

// The guest's basket (Part 8 Step 7), kept on the phone per table code so a
// reload or a look at another page doesn't lose it. A store for
// useSyncExternalStore: the server (and a phone that blocks storage) sees
// an empty basket; the same array comes back until it changes.

const EMPTY: BasketLine[] = [];
const keyOf = (token: string) => `ringz.menu.basket.${token}`;
const cache = new Map<string, BasketLine[]>();
const listeners = new Set<() => void>();

function load(token: string): BasketLine[] {
  const cached = cache.get(token);
  if (cached) return cached;
  let lines = EMPTY;
  try {
    const raw = localStorage.getItem(keyOf(token));
    lines = raw ? readBasket(JSON.parse(raw)) : EMPTY;
  } catch {
    lines = EMPTY;
  }
  cache.set(token, lines);
  return lines;
}

function save(token: string, lines: BasketLine[]) {
  cache.set(token, lines);
  try {
    if (lines.length) localStorage.setItem(keyOf(token), JSON.stringify(lines));
    else localStorage.removeItem(keyOf(token));
  } catch {}
  listeners.forEach((l) => l());
}

export const basketStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  get: (token: string) => load(token),
  getServer: () => EMPTY,
  add(token: string, line: Omit<BasketLine, "key">) {
    save(token, addToBasket(load(token), line));
  },
  setQuantity(token: string, key: string, quantity: number) {
    save(token, quantity <= 0 ? load(token).filter((l) => l.key !== key) : load(token).map((l) => (l.key === key ? { ...l, quantity } : l)));
  },
  // A new note makes it another line: it joins one that already has it.
  setNote(token: string, key: string, note: string) {
    const lines = load(token);
    const line = lines.find((l) => l.key === key);
    if (!line) return;
    save(token, addToBasket(lines.filter((l) => l.key !== key), { productId: line.productId, modifierIds: line.modifierIds, note, quantity: line.quantity }));
  },
  clear(token: string) {
    save(token, EMPTY);
  },
};
