"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { clampScanSettings, DEFAULT_SCAN, isTextEntry, ScanDetector, type ScanAttempt, type ScanSettings } from "@/lib/hardware/scan";

// The global scan listener (lib/hardware/scan.ts tells a scan from typing).
// Mounted once per layout (dashboard, POS). While no text field has focus,
// fast keys ending in Enter are a scan: its Enter is swallowed (so it can't
// press a focused button) and the code goes to the current screen —
//
//   useScan(handler)                 a screen's own (POS: add the item)
//   useScan(handler, { fallback })   the layout's default when the screen
//                                    has none (back office: open the product)
//
// Camera scans (CameraScanButton) arrive through dispatch(), the same way.
// The thresholds are this browser's (Settings › Scanner test).

export type ScanSource = "scanner" | "camera";
export type ScanHandler = (code: string, source: ScanSource) => void;
export type ScanEvent = { attempt: ScanAttempt | null; code: string; source: ScanSource; at: number; handled: boolean };

const STORAGE_KEY = "ringz_scan_settings";
const SETTINGS_EVENT = "ringz-scan-settings";

function readSettings(): ScanSettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? clampScanSettings(JSON.parse(raw)) : DEFAULT_SCAN;
  } catch {
    return DEFAULT_SCAN;
  }
}

let cachedRaw: string | null | undefined;
let cachedSettings: ScanSettings = DEFAULT_SCAN;
function snapshot(): ScanSettings {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    raw = null;
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedSettings = readSettings();
  }
  return cachedSettings;
}
function subscribeSettings(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(SETTINGS_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(SETTINGS_EVENT, onChange);
  };
}

// This browser's scanner settings, and a setter (null: back to the defaults).
export function useScanSettings(): [ScanSettings, (next: ScanSettings | null) => void] {
  const settings = useSyncExternalStore(subscribeSettings, snapshot, () => DEFAULT_SCAN);
  const save = useCallback((next: ScanSettings | null) => {
    try {
      if (next) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(clampScanSettings(next)));
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Storage blocked: the defaults stay.
    }
    window.dispatchEvent(new Event(SETTINGS_EVENT));
  }, []);
  return [settings, save];
}

type Registry = {
  register: (handler: { current: ScanHandler }, fallback: boolean) => () => void;
  dispatch: (code: string, source: ScanSource) => boolean;
  watch: (listener: (event: ScanEvent) => void) => () => void;
};
const ScanContext = createContext<Registry | null>(null);

export default function ScanProvider({ children }: { children: ReactNode }) {
  const [settings] = useScanSettings();
  const handlers = useRef<{ current: ScanHandler }[]>([]);
  const fallbacks = useRef<{ current: ScanHandler }[]>([]);
  const watchers = useRef(new Set<(event: ScanEvent) => void>());
  const limits = useRef(settings);

  const registry = useMemo<Registry>(() => {
    const route = (code: string, source: ScanSource) => {
      const handler = handlers.current.at(-1) ?? fallbacks.current.at(-1);
      handler?.current(code, source);
      return !!handler;
    };
    return {
      register(handler, fallback) {
        const list = fallback ? fallbacks : handlers;
        list.current = [...list.current, handler];
        return () => {
          list.current = list.current.filter((h) => h !== handler);
        };
      },
      dispatch(code, source) {
        const handled = route(code, source);
        for (const w of watchers.current) w({ attempt: null, code, source, at: Date.now(), handled });
        return handled;
      },
      watch(listener) {
        watchers.current.add(listener);
        return () => {
          watchers.current.delete(listener);
        };
      },
    };
  }, []);

  useEffect(() => {
    limits.current = settings;
  }, [settings]);

  useEffect(() => {
    const d = new ScanDetector(limits.current);
    const onKey = (event: KeyboardEvent) => {
      d.settings = limits.current;
      if (event.ctrlKey || event.altKey || event.metaKey || isTextEntry(document.activeElement)) {
        d.reset();
        return;
      }
      const attempt = d.key(event.key, event.timeStamp || performance.now());
      if (!attempt) return;
      let handled = false;
      if (attempt.accepted) {
        // The scan's Enter: never a click on whatever button has focus.
        event.preventDefault();
        event.stopPropagation();
        const handler = handlers.current.at(-1) ?? fallbacks.current.at(-1);
        if (handler) {
          handler.current(attempt.code, "scanner");
          handled = true;
        }
      }
      for (const w of watchers.current) w({ attempt, code: attempt.code, source: "scanner", at: Date.now(), handled });
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  return <ScanContext.Provider value={registry}>{children}</ScanContext.Provider>;
}

// The current screen's scan handler, while it's mounted. `enabled: false`
// pauses it (e.g. while a payment pop-up is open).
export function useScan(handler: ScanHandler, options: { fallback?: boolean; enabled?: boolean } = {}): void {
  const registry = useContext(ScanContext);
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  const { fallback = false, enabled = true } = options;
  useEffect(() => {
    if (!registry || !enabled) return;
    return registry.register(ref, fallback);
  }, [registry, fallback, enabled]);
}

// Every scan attempt (accepted or not) — the Scanner test page.
export function useScanEvents(listener: (event: ScanEvent) => void): void {
  const registry = useContext(ScanContext);
  const ref = useRef(listener);
  useEffect(() => {
    ref.current = listener;
  });
  useEffect(() => registry?.watch((e) => ref.current(e)), [registry]);
}

// Hands a code in as if it were scanned (the camera).
export function useScanDispatch(): (code: string, source?: ScanSource) => boolean {
  const registry = useContext(ScanContext);
  return useCallback((code: string, source: ScanSource = "camera") => registry?.dispatch(code, source) ?? false, [registry]);
}

// Whether this device has a camera (for the camera button).
export function useHasCamera(): boolean {
  const [has, setHas] = useState(false);
  useEffect(() => {
    let live = true;
    navigator.mediaDevices
      ?.enumerateDevices?.()
      .then((devices) => live && setHas(devices.some((d) => d.kind === "videoinput")))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return has;
}
