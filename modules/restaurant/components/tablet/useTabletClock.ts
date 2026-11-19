"use client";

import { useEffect, useState } from "react";
import { formatAppTime } from "../../lib/time";

// The tablet header's clock ("19:42", the restaurant's time zone), filled in
// once the page is up so the server's render and the tablet's agree.
export function useTabletClock(): string | null {
  const [now, setNow] = useState<string | null>(null);
  useEffect(() => {
    const tick = () => setNow(formatAppTime(new Date()));
    tick();
    const timer = window.setInterval(tick, 10_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}
