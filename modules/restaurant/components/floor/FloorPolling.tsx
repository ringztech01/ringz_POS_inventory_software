"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Live floor: re-renders the page from the server every `intervalMs` while
// the tab is visible (router.refresh — no websockets). Hidden tabs stop
// polling and catch up the moment they're shown again.
export default function FloorPolling({ intervalMs = 5000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (!timer) timer = setInterval(() => router.refresh(), intervalMs);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        router.refresh();
        start();
      } else {
        stop();
      }
    }

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [router, intervalMs]);

  return null;
}
