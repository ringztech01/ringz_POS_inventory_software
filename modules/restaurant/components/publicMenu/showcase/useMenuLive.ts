"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { MenuStatuses, PublicMenuItem } from "../../../lib/publicMenu";
import type { GuestRequests } from "../../../lib/tableRequests";
import { isUnderway, type GuestOrderLineView, type MenuOrdering } from "../../../lib/guestOrdering";

// The Showcase menu's live check (the same one the Classic menu runs): every
// item's state every 30 s and whenever the page is back in view, every few
// seconds while a request or an order is underway; the guest's requests and
// this phone's sent lines with it. A change never moves the dish the guest
// is looking at.

const POLL_MS = 30_000;
const POLL_WAITING_MS = 8_000;

export type OrderState = { paused: boolean; lines: GuestOrderLineView[] };

export function useMenuLive({
  token,
  items,
  requests: firstRequests,
  ordering,
  stickyBottom,
}: {
  token: string;
  items: PublicMenuItem[];
  requests: GuestRequests | null;
  ordering: MenuOrdering | null;
  // Where the sticky bar ends: the first card below it stays put.
  stickyBottom: () => number;
}) {
  const [statuses, setStatuses] = useState<MenuStatuses>(() => Object.fromEntries(items.map((i) => [i.id, i.status])));
  const [offline, setOffline] = useState(false);
  const [requests, setRequests] = useState<GuestRequests | null>(firstRequests);
  const [orderState, setOrderState] = useState<OrderState | null>(ordering ? { paused: ordering.paused, lines: [] } : null);
  const checkNow = useRef<() => void>(() => undefined);
  const anchor = useRef<{ id: string; top: number } | null>(null);
  const bottomOf = useRef(stickyBottom);
  useEffect(() => {
    bottomOf.current = stickyBottom;
  });
  const waiting = (!!requests && Object.values(requests).some((state) => state !== null)) || !!orderState?.lines.some((l) => isUnderway(l.stage));

  useEffect(() => {
    let stopped = false;
    async function check() {
      try {
        const response = await fetch(`/menu/${encodeURIComponent(token)}/status`, { cache: "no-store" });
        if (response.status === 404) {
          window.location.reload();
          return;
        }
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as { statuses: MenuStatuses; requests: GuestRequests | null; order: OrderState | null };
        if (stopped) return;
        setOrderState((before) => (body.order && before && JSON.stringify(before) === JSON.stringify(body.order) ? before : body.order));
        if (body.requests) setRequests((before) => (before && JSON.stringify(before) === JSON.stringify(body.requests) ? before : body.requests));
        const top = bottomOf.current();
        const first = [...document.querySelectorAll<HTMLElement>("[data-menu-item]")].find((c) => c.getBoundingClientRect().bottom > top);
        anchor.current = first ? { id: first.dataset.menuItem ?? "", top: first.getBoundingClientRect().top } : null;
        setStatuses((before) => {
          const next: MenuStatuses = {};
          for (const id of Object.keys(before)) if (body.statuses[id]) next[id] = body.statuses[id];
          const same = Object.keys(next).length === Object.keys(before).length && Object.keys(next).every((id) => next[id] === before[id]);
          return same ? before : next;
        });
        setOffline(false);
      } catch {
        if (!stopped) setOffline(true);
      }
    }
    const timer = window.setInterval(check, waiting ? POLL_WAITING_MS : POLL_MS);
    checkNow.current = () => void check();
    const onShow = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onShow);
    window.addEventListener("focus", onShow);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onShow);
      window.removeEventListener("focus", onShow);
    };
  }, [token, waiting]);

  // This phone's own order, as soon as the page is up (ordering on).
  const ordersHere = !!ordering;
  useEffect(() => {
    if (ordersHere) checkNow.current();
  }, [ordersHere]);

  useLayoutEffect(() => {
    const kept = anchor.current;
    anchor.current = null;
    if (!kept) return;
    const card = document.querySelector<HTMLElement>(`[data-menu-item="${CSS.escape(kept.id)}"]`);
    if (card) {
      const moved = card.getBoundingClientRect().top - kept.top;
      if (moved) window.scrollBy(0, moved);
    }
  }, [statuses]);

  return { statuses, offline, requests, setRequests, orderState, checkNow: () => checkNow.current() };
}

// A sheet that's a step in the phone's history: Back closes it. Opening
// pushes a step; closing takes it back.
export function historyStep<K extends string>(key: K) {
  return {
    push(value: unknown = true) {
      window.history.pushState({ ...((window.history.state as object | null) ?? {}), [key]: value }, "");
    },
    back() {
      if ((window.history.state as Record<string, unknown> | null)?.[key]) window.history.back();
    },
  };
}
