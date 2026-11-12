"use client";

import { useEffect, useSyncExternalStore } from "react";
import { ToastBar, Toaster } from "react-hot-toast";

// The app's one toaster (app/layout.tsx). While the restaurant touch POS is
// on screen (useTouchToasts), its messages sit over the bottom of the menu
// grid, centred, as white cards (the Restaurant POS design), with no
// slide-in (no animation over 120 ms). Everywhere else, as always.

let touchScreens = 0;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const isTouch = () => touchScreens > 0;

// The touch POS: its toasts while it's mounted.
export function useTouchToasts(): void {
  useEffect(() => {
    touchScreens += 1;
    listeners.forEach((l) => l());
    return () => {
      touchScreens -= 1;
      listeners.forEach((l) => l());
    };
  }, []);
}

const DEFAULT_OPTIONS = {
  style: {
    fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
    fontSize: 13.5,
    borderRadius: 9,
    border: "1px solid #dde2e3",
    boxShadow: "0 8px 24px -6px rgba(23,27,28,.20)",
  },
  success: {
    iconTheme: { primary: "#0f7d6a", secondary: "#fff" },
    style: { border: "1px solid #86cbc0" },
  },
  error: {
    iconTheme: { primary: "#b3261e", secondary: "#fff" },
    style: { border: "1px solid #f0c4c1" },
  },
};

const TOUCH_OPTIONS = {
  style: {
    fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
    fontSize: 15,
    fontWeight: 600,
    borderRadius: 4,
    border: "none",
    boxShadow: "0 8px 24px rgba(0,0,0,.4)",
    background: "#FFFFFF",
    color: "#171B1C",
    padding: "12px 18px",
    maxWidth: 560,
  },
  success: { iconTheme: { primary: "#0F7D6A", secondary: "#fff" } },
  error: { iconTheme: { primary: "#B3261E", secondary: "#fff" } },
};

// Over the touch POS's grid (right of its check — max(440px, 32 %) of the
// window less the 6 px frame padding — and above its 78 px function bar).
const TOUCH_AREA = { bottom: 98, left: "calc(12px + max(440px, (100vw - 12px) * 0.32))", right: 6 };

export default function AppToaster() {
  const touch = useSyncExternalStore(subscribe, isTouch, () => false);
  if (!touch) return <Toaster position="top-right" toastOptions={DEFAULT_OPTIONS} />;
  return (
    <Toaster position="bottom-center" containerStyle={TOUCH_AREA} gutter={6} toastOptions={TOUCH_OPTIONS}>
      {(t) => <ToastBar toast={t} style={{ ...t.style, animation: "none" }} />}
    </Toaster>
  );
}
