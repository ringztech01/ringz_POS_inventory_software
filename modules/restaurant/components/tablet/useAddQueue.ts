"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { didLand, isVersionConflict, matchQuantity, MAX_CONFLICT_RETRIES, queueKey, readStoredQueue, rejectionText, type QueueEntry } from "../../lib/tabletQueue";
import { addOrderLine } from "../../server/actions/orders";
import { tabletOrderSync } from "../../server/actions/tablet";
import type { OrderChangeResult } from "../../server/services/orders";
import { useTabletConnection } from "./useTabletConnection";

// Dishes tapped on the tablet's Order screen (Part 6g Step 6): on the check
// at once, kept on the tablet until the server has them, sent one at a time
// in the order they were tapped. With no connection they wait ("waiting to
// sync") and go when it's back, through a reload too. If an answer was lost,
// the order is read first, so a dish that did get through isn't added again.
// A refusal (sold out, the order closed) takes the dish off with a toast:
// a line is never lost silently.

const RETRY_MS = 3000;
type Run = (change: (version: number) => Promise<OrderChangeResult>, options?: { quiet?: boolean }) => Promise<boolean>;

function store(orderId: string, title: string, entries: QueueEntry[]) {
  try {
    const waiting = entries.filter((e) => e.doneAt === null);
    if (waiting.length) localStorage.setItem(queueKey(orderId), JSON.stringify({ title, entries: waiting }));
    else localStorage.removeItem(queueKey(orderId));
  } catch {
    // No storage (a private window): the queue lasts as long as the screen.
  }
}

export function useAddQueue({ orderId, title, run, onSaved }: { orderId: string; title: string; run: Run; onSaved: () => void }) {
  const { online, check } = useTabletConnection();
  const [entries, setEntries] = useState<QueueEntry[]>([]);
  const list = useRef<QueueEntry[]>([]);
  const pumping = useRef(false);
  const retry = useRef(0);
  const latest = useRef({ run, onSaved, title, online });
  useEffect(() => {
    latest.current = { run, onSaved, title, online };
  });

  const update = useCallback(
    (change: (now: QueueEntry[]) => QueueEntry[]) => {
      list.current = change(list.current);
      setEntries(list.current);
      store(orderId, latest.current.title, list.current);
    },
    [orderId],
  );
  const patch = useCallback((key: string, fields: Partial<QueueEntry>) => update((now) => now.map((e) => (e.key === key ? { ...e, ...fields } : e))), [update]);

  const pump = useCallback(async () => {
    if (pumping.current) return;
    pumping.current = true;
    window.clearTimeout(retry.current);
    const later = () => {
      retry.current = window.setTimeout(() => void pumpRef.current(), RETRY_MS);
    };
    let conflicts = 0;
    try {
      for (;;) {
        const head = list.current.find((e) => e.doneAt === null);
        if (!head) return;
        if (!latest.current.online && !(await check())) return later();

        // The order as it is now: its version, and whether a lost try landed.
        const state = await tabletOrderSync(orderId).catch(() => null);
        if (!state) {
          void check();
          return later();
        }
        if (!state.ok) {
          toast.error(rejectionText(head.name, state.error), { id: head.key });
          update((now) => now.filter((e) => e.key !== head.key));
          continue;
        }
        if (didLand(head, state.lines)) {
          patch(head.key, { doneAt: state.version, baseline: null });
          latest.current.onSaved();
          continue;
        }
        patch(head.key, { baseline: matchQuantity(state.lines, head) });

        let lost = false;
        let refusal: string | null = null;
        let saved: number | null = null;
        await latest.current.run(
          async (version) => {
            try {
              const result = await addOrderLine({ orderId, version: Math.max(version, state.version), productId: head.productId, modifierIds: head.modifierIds, note: "", quantity: 1 });
              if (result.ok) {
                saved = result.version;
                return result;
              }
              refusal = result.error;
            } catch {
              lost = true;
            }
            // This queue says what went wrong itself.
            return { ok: false, error: "" };
          },
          { quiet: true },
        );

        if (lost) {
          void check();
          return later();
        }
        if (saved !== null) {
          conflicts = 0;
          patch(head.key, { doneAt: saved, baseline: null });
          latest.current.onSaved();
          continue;
        }
        const error = refusal ?? "Couldn't add it.";
        if (isVersionConflict(error) && ++conflicts <= MAX_CONFLICT_RETRIES) continue;
        conflicts = 0;
        toast.error(rejectionText(head.name, error), { id: head.key });
        update((now) => now.filter((e) => e.key !== head.key));
        latest.current.onSaved();
      }
    } finally {
      pumping.current = false;
    }
  }, [orderId, check, patch, update]);
  const pumpRef = useRef(pump);
  useEffect(() => {
    pumpRef.current = pump;
  }, [pump]);

  // What was waiting when the screen last closed.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved = readStoredQueue(JSON.parse(localStorage.getItem(queueKey(orderId)) ?? "null"));
        if (saved.entries.length) {
          update(() => saved.entries);
          void pumpRef.current();
        }
      } catch {
        // Nothing readable was kept.
      }
    }, 0);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(retry.current);
    };
  }, [orderId, update]);

  // The connection's back.
  useEffect(() => {
    if (online) void pumpRef.current();
  }, [online]);

  const enqueue = useCallback(
    (entry: Omit<QueueEntry, "baseline" | "doneAt">) => {
      update((now) => [...now, { ...entry, baseline: null, doneAt: null }]);
      void pumpRef.current();
    },
    [update],
  );
  const forget = useCallback((version: number) => {
    if (list.current.some((e) => e.doneAt !== null && version >= e.doneAt)) update((now) => now.filter((e) => e.doneAt === null || version < e.doneAt));
  }, [update]);

  return { entries, enqueue, forget };
}
