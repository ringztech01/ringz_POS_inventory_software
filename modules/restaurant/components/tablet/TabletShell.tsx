"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ToastBar, Toaster } from "react-hot-toast";
import DeviceBeacon from "@/components/hardware/DeviceBeacon";
import { FONT, PRESS_CSS, T } from "./tabletTheme";
import { TabletConnectionProvider, useTabletConnection } from "./useTabletConnection";

// Every tablet screen sits in this (Part 6g): the offline shell (a service
// worker for /t/ that shows "Can't reach server, retrying…" when a screen
// can't load), the device beacon, the shared press state and — for the
// portrait-locked screens (PIN login, Order) — the orientation lock: the
// installed app asks the tablet to stay upright, and a "Rotate to
// portrait" screen covers the page in landscape wherever it can't.
// Tables (`orientation="any"`) follows the tablet's rotation.

type Orientation = "portrait" | "any";
type LockableOrientation = ScreenOrientation & { lock?: (orientation: "portrait" | "any") => Promise<void>; unlock?: () => void };

// "Offline · retrying": under the header, over the screen (nothing moves).
function OfflineBar() {
  const { online } = useTabletConnection();
  if (online) return null;
  return (
    <div role="status" data-offline-bar className="tb-offline" style={{ position: "absolute", left: 0, right: 0, height: 44, zIndex: 50, background: "#C81E1E", color: T.text, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, fontWeight: 900, pointerEvents: "none" }}>
      Offline · retrying
    </div>
  );
}

// Keeps the screen on while the app is open, where the browser allows it
// (HTTPS only). The browser lets go whenever the app is hidden, so it's
// asked again each time the app comes back.
function useWakeLock(enabled: boolean): "on" | "off" | "unavailable" {
  const [state, setState] = useState<"on" | "off" | "unavailable">("off");
  useEffect(() => {
    if (!enabled) return;
    if (!("wakeLock" in navigator)) {
      const timer = window.setTimeout(() => setState("unavailable"), 0);
      return () => window.clearTimeout(timer);
    }
    let stopped = false;
    let sentinel: WakeLockSentinel | null = null;
    const ask = async () => {
      if (document.visibilityState !== "visible" || (sentinel && !sentinel.released)) return;
      try {
        const lock = await navigator.wakeLock.request("screen");
        if (stopped) return void lock.release();
        sentinel = lock;
        setState("on");
      } catch {
        setState("unavailable");
      }
    };
    void ask();
    document.addEventListener("visibilitychange", ask);
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", ask);
      void sentinel?.release();
    };
  }, [enabled]);
  return enabled ? state : "off";
}

export default function TabletShell({ orientation, signedIn = true, offlineBar = true, wakeLock = false, children }: { orientation: Orientation; signedIn?: boolean; offlineBar?: boolean; wakeLock?: boolean; children: ReactNode }) {
  const wake = useWakeLock(wakeLock);
  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/t/sw.js", { scope: "/t/" }).catch(() => undefined);
  }, []);

  useEffect(() => {
    // Only an installed (standalone) app may lock; a browser tab refuses,
    // and the CSS screen below covers that case.
    const screenOrientation = (typeof screen !== "undefined" ? screen.orientation : undefined) as LockableOrientation | undefined;
    if (!screenOrientation?.lock) return;
    if (orientation === "portrait") screenOrientation.lock("portrait").catch(() => undefined);
    else screenOrientation.unlock?.();
  }, [orientation]);

  return (
    <div data-tablet-shell data-orientation={orientation} data-wake-lock={wake} style={{ position: "fixed", inset: 0, background: T.bg, color: T.text, fontFamily: FONT, WebkitFontSmoothing: "antialiased", userSelect: "none", WebkitUserSelect: "none", overflow: "hidden" }}>
      <style>{`${PRESS_CSS}
.tb-rotate { display: none; }
.tb-offline { top: 96px; }
@media (orientation: landscape) {
  .tb-offline { top: 88px; }
  [data-orientation="portrait"] > .tb-rotate { display: flex; }
  [data-orientation="portrait"] > .tb-page { visibility: hidden; }
}`}</style>
      {signedIn && <DeviceBeacon />}
      <TabletConnectionProvider>
        <div className="tb-page" style={{ position: "absolute", inset: 0 }}>
          {children}
        </div>
        {offlineBar && <OfflineBar />}
      </TabletConnectionProvider>
      {/* The order screens' own messages ("+1 Star Lager", a refusal): the
          design's white one-line toast near the top, no slide-in. */}
      <Toaster
        position="top-center"
        containerStyle={{ top: 110, zIndex: 60 }}
        toastOptions={{ duration: 1800, style: { background: T.text, color: "#000", fontFamily: FONT, fontSize: 21, fontWeight: 800, padding: "14px 20px", borderRadius: 10, boxShadow: "none", maxWidth: 720 } }}
      >
        {(t) => <ToastBar toast={t} style={{ ...t.style, animation: "none" }} />}
      </Toaster>
      {orientation === "portrait" && (
        <div className="tb-rotate" data-rotate-prompt role="alert" style={{ position: "absolute", inset: 0, zIndex: 100, background: T.bg, flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 28 }}>
          <span aria-hidden style={{ width: 120, height: 180, borderRadius: 18, border: `8px solid ${T.text}`, boxSizing: "border-box" }} />
          <span style={{ fontSize: 44, fontWeight: 900 }}>Rotate to portrait</span>
          <span style={{ fontSize: 20, fontWeight: 700, color: T.quiet }}>This screen works upright.</span>
        </div>
      )}
    </div>
  );
}
