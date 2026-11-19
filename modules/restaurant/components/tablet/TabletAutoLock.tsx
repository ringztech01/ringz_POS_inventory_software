"use client";

import { useEffect, useRef } from "react";
import { TABLET_LOGIN } from "../../lib/tabletDevice";
import { lockPos } from "../../server/actions/session";
import { useTabletConnection } from "./useTabletConnection";

// Auto-lock (Part 6g Step 6): after the idle time set for this person
// (Settings › Restaurant › Touch POS; Part 6f), a paired tablet ends the
// session and the PIN login comes back. Unsent lines are already on the
// order. It waits while something holds it (a payment open, dishes still
// saving) and while the server can't be reached. Checked every second
// against the clock, so a tablet that slept locks as soon as it wakes.
export default function TabletAutoLock({ seconds, hold = false, before }: { seconds: number; hold?: boolean; before?: () => Promise<unknown> }) {
  const { online } = useTabletConnection();
  const lastTouch = useRef(0);
  const locking = useRef(false);
  const latest = useRef({ hold, online, before });
  useEffect(() => {
    latest.current = { hold, online, before };
  });

  useEffect(() => {
    if (seconds <= 0) return;
    lastTouch.current = Date.now();
    const touched = () => {
      lastTouch.current = Date.now();
    };
    const options = { capture: true, passive: true } as const;
    window.addEventListener("pointerdown", touched, options);
    window.addEventListener("keydown", touched, options);
    const timer = window.setInterval(() => {
      const now = latest.current;
      if (now.hold || !now.online) return touched();
      if (locking.current || Date.now() - lastTouch.current < seconds * 1000) return;
      locking.current = true;
      void (async () => {
        await now.before?.().catch(() => null);
        const result = await lockPos({ endShift: false }).catch(() => null);
        if (result?.ok) return window.location.replace(TABLET_LOGIN);
        locking.current = false;
        touched();
      })();
    }, 1000);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("pointerdown", touched, options);
      window.removeEventListener("keydown", touched, options);
    };
  }, [seconds]);
  return null;
}
