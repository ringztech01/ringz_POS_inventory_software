"use client";

import { useCallback, useSyncExternalStore } from "react";
import toast from "react-hot-toast";

function subscribe(onChange: () => void) {
  document.addEventListener("fullscreenchange", onChange);
  return () => document.removeEventListener("fullscreenchange", onChange);
}

// The browser's fullscreen state for the whole POS page. Read from the
// document (not kept in React), so leaving with Esc or F11 is reflected too.
export function useFullscreen() {
  const active = useSyncExternalStore(
    subscribe,
    () => !!document.fullscreenElement,
    () => false,
  );

  const toggle = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      toast.error("Fullscreen isn't available in this browser.");
    }
  }, []);

  return { active, toggle };
}
