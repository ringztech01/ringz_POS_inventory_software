"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

// Is the server there? (Part 6g Step 6.) One small request every few
// seconds, for every tablet screen: the red "Offline · retrying" bar, what's
// blocked while it's gone, and when the add queue may send again.
//
// Refreshes go through here too. When a screen's refresh fails, the app's
// router gives up and reloads the whole page — which, with no connection,
// would throw away the screen the waiter is working on. So a screen only
// refreshes right after the server has answered.

const PING_TIMEOUT_MS = 4000;
const EVERY_ONLINE_MS = 10_000;
const EVERY_OFFLINE_MS = 3000;
// One miss is checked again straight away; two in a row is offline.
const AFTER_A_MISS_MS = 1500;

type Connection = { online: boolean; check: () => Promise<boolean> };
const Context = createContext<Connection>({ online: true, check: async () => true });

export const useTabletConnection = () => useContext(Context);

export function TabletConnectionProvider({ children }: { children: ReactNode }) {
  const [online, setOnline] = useState(true);
  const misses = useRef(0);
  const flying = useRef<Promise<boolean> | null>(null);

  const check = useCallback(() => {
    if (flying.current) return flying.current;
    const attempt = (async () => {
      const stop = new AbortController();
      const timer = window.setTimeout(() => stop.abort(), PING_TIMEOUT_MS);
      try {
        const response = await fetch(`/t/offline?ping=${Date.now()}`, { cache: "no-store", signal: stop.signal });
        if (!response.ok) throw new Error(String(response.status));
        misses.current = 0;
        setOnline(true);
        return true;
      } catch {
        misses.current += 1;
        if (misses.current >= 2 || !navigator.onLine) setOnline(false);
        return false;
      } finally {
        window.clearTimeout(timer);
        flying.current = null;
      }
    })();
    flying.current = attempt;
    return attempt;
  }, []);

  useEffect(() => {
    let stopped = false;
    let timer = 0;
    const loop = async () => {
      const up = await check();
      if (stopped) return;
      timer = window.setTimeout(loop, up ? EVERY_ONLINE_MS : misses.current === 1 ? AFTER_A_MISS_MS : EVERY_OFFLINE_MS);
    };
    timer = window.setTimeout(loop, EVERY_ONLINE_MS);
    const onChange = () => void check();
    const onLost = () => setOnline(false);
    window.addEventListener("online", onChange);
    window.addEventListener("offline", onLost);
    document.addEventListener("visibilitychange", onChange);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      window.removeEventListener("online", onChange);
      window.removeEventListener("offline", onLost);
      document.removeEventListener("visibilitychange", onChange);
    };
  }, [check]);

  const value = useMemo(() => ({ online, check }), [online, check]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

// A refresh that can't throw the screen away.
export function useSafeRefresh(): () => Promise<void> {
  const router = useRouter();
  const { check } = useTabletConnection();
  return useCallback(async () => {
    if (await check()) router.refresh();
  }, [router, check]);
}

// The screen's live updates: every few seconds while it's in view.
export function TabletPolling({ intervalMs = 5000 }: { intervalMs?: number }) {
  const refresh = useSafeRefresh();
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const timer = window.setInterval(tick, intervalMs);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [refresh, intervalMs]);
  return null;
}
