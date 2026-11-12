"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { useTouchToasts } from "@/components/providers/AppToaster";
import { touchThemeVars } from "../../lib/theme";
import { leaveEmptyOrder, newPosOrder, openPosDrawer, switchPosUser } from "../../server/actions/pos";
import { lockPos, startMyShift } from "../../server/actions/session";
import ShiftPrompt from "./ShiftPrompt";
import HandoverDialog from "./HandoverDialog";
import type { Handover } from "../../server/services/shifts";
import type { Approver } from "../../server/queries/approvers";
import type { PosStaff } from "../../server/queries/posScreen";
import BarTabDialog from "./BarTabDialog";
import DrawerDialog from "./DrawerDialog";
import PinSwitch, { PinWelcome } from "./PinSwitch";
import { staffBadge } from "../../lib/posSpeed";
import { useManagerApproval, withManager, type AskManager } from "./useManagerApproval";
import { useServiceRoutes } from "../ServiceRoutes";
import { useScan } from "@/components/hardware/ScanProvider";

// The touch Tables screen (lib/serviceRoutes owns the path).
export { SERVICE_TABLES as POS_FLOOR } from "../../lib/serviceRoutes";

// Locked (auto-lock) — kept for the tab, so a reload doesn't open it.
const LOCK_KEY = "ringz_pos_locked";
const lockListeners = new Set<() => void>();
function readLocked() {
  try {
    return sessionStorage.getItem(LOCK_KEY) === "1";
  } catch {
    return false;
  }
}
function writeLocked(locked: boolean) {
  try {
    if (locked) sessionStorage.setItem(LOCK_KEY, "1");
    else sessionStorage.removeItem(LOCK_KEY);
  } catch {
    // No storage (private window): the lock lasts until a reload.
  }
  lockListeners.forEach((listener) => listener());
}
const subscribeLock = (listener: () => void) => {
  lockListeners.add(listener);
  return () => {
    lockListeners.delete(listener);
  };
};

const IDLE_EVENTS = ["pointerdown", "keydown", "wheel"] as const;
const NO_SHIFT = { clockOn: false, onShift: false };
const UNREACHABLE = "Couldn't reach the server. Check the connection and try again.";

// Every button and link on the POS — the shared pop-ups too — darkens the
// moment it's pressed (TouchButton does it itself; this covers the rest).
// And while the POS is up, its messages don't glide (react-hot-toast moves
// its stack over 230 ms): nothing on the POS animates over 120 ms.
const PRESSED = `[data-pos-touch] button:not(:disabled):not([data-lift]):active, [data-pos-touch] a:not([data-lift]):active { filter: brightness(.8); }
[data-pos-touch] [data-lift]:not(:disabled):active { background: var(--t-keyDown, #3A424C) !important; }
[data-rht-toaster] > div { transition: none !important; }`;

type PosSessionValue = {
  userId: string;
  userName: string;
  busy: boolean;
  openSwitch: () => void;
  goTables: (fromOrderId?: string) => void;
  newTakeaway: () => void;
  openBarTab: () => void;
  // The manager PIN pad (voids, refunds, discounts over the limit).
  askManager: AskManager;
  // Open drawer: only on a till with a cash drawer (null otherwise).
  openDrawer: (() => void) | null;
  // Back office (Part 6f Step 5): the Restaurant dashboard, or the app's for
  // those who can't open that one — null for a Service-level role, who has
  // no back office (the key isn't rendered).
  leaveHref: string | null;
  exit: () => void;
  // The order on screen has nothing on it (or no longer): leaving it —
  // Tables, a new takeaway or tab, Exit — throws it away so its table is
  // free (an empty order opened by mistake doesn't hold the table).
  markEmpty: (orderId: string, empty: boolean) => void;
  // LOCK: back to the PIN screen now (on a PIN terminal the session ends;
  // with a shift open it asks "End shift?" first).
  lock: () => void;
  // Auto-lock waits while something holds it: a payment in progress
  // (Part 6f Step 6). `reason`: who's holding ("pay").
  holdAutoLock: (reason: string, on: boolean) => void;
  lightTheme: boolean;
};

const SessionContext = createContext<PosSessionValue | null>(null);

export function usePosSession(): PosSessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("usePosSession outside PosSession");
  return value;
}

// The touch POS's till session (Part 6e Step 5): who's on it (the header's
// name opens the PIN switch), auto-lock after the set time without a tap
// (a PIN opens it — and makes the till theirs), and the quick order types:
// Dine-in (the floor plan), Takeaway, Bar tab (a name first).
export default function PosSession({
  user,
  staff,
  withoutPin,
  lockSeconds,
  drawer = null,
  leaveHref = "/restaurant",
  lightTheme = false,
  terminal = false,
  shift = NO_SHIFT,
  training = false,
  children,
}: {
  user: { id: string; name: string };
  staff: PosStaff[];
  withoutPin: number;
  lockSeconds: number;
  // This till's cash drawer: who can approve opening it by hand.
  drawer?: { approvers: Approver[] } | null;
  leaveHref?: string | null;
  // Restaurant › Touch POS › Theme.
  lightTheme?: boolean;
  // Part 6f Step 6: a PIN terminal (LOCK, the user chip and auto-lock end the
  // session and the PIN screen comes back); the person's shift (clock in / out).
  terminal?: boolean;
  shift?: { clockOn: boolean; onShift: boolean };
  // Training mode (Step 7f): a banner says nothing here is real.
  training?: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const routes = useServiceRoutes();
  const [switching, setSwitching] = useState(false);
  const [welcome, setWelcome] = useState<{ name: string; initials: string; note: string | null } | null>(null);
  useEffect(() => {
    if (!welcome) return;
    const timer = setTimeout(() => setWelcome(null), 1100);
    return () => clearTimeout(timer);
  }, [welcome]);
  const [barTab, setBarTab] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const manager = useManagerApproval();
  useTouchToasts();
  const [busy, startBusy] = useTransition();
  const emptyOrder = useRef<string | null>(null);
  const markEmpty = useCallback((orderId: string, empty: boolean) => {
    if (empty) emptyOrder.current = orderId;
    else if (emptyOrder.current === orderId) emptyOrder.current = null;
  }, []);
  // Throw away the empty order on screen (if there is one) before leaving it.
  const dropEmpty = useCallback(async (): Promise<string | null> => {
    const id = emptyOrder.current;
    if (!id) return null;
    emptyOrder.current = null;
    const result = await leaveEmptyOrder(id).catch(() => null);
    return result?.ok && result.discarded ? id : null;
  }, []);
  // Locking needs someone able to open it again: on a PIN terminal, the
  // PIN screen; elsewhere, someone with a PIN. Auto-lock, a time too.
  const canLock = terminal || staff.length > 0;
  const autoLock = canLock && lockSeconds > 0;
  const lockedFlag = useSyncExternalStore(subscribeLock, readLocked, () => false);
  const locked = !terminal && canLock && lockedFlag;
  const [shiftPrompt, setShiftPrompt] = useState<"start" | "end" | null>(null);
  const [shiftBusy, setShiftBusy] = useState(false);
  const [handover, setHandover] = useState<Handover | null>(null);
  const holds = useRef(new Set<string>());
  const holdAutoLock = useCallback((reason: string, on: boolean) => {
    if (on) holds.current.add(reason);
    else holds.current.delete(reason);
  }, []);

  // LOCK itself. On a PIN terminal the session ends and the PIN screen comes
  // back; nothing on the order is lost (its lines are saved as they're
  // added; an empty order is let go so its table is free). Elsewhere the
  // screen locks until a PIN opens it. `endShift`: their shift ends first.
  // Open tables at End shift (Step 7a): handed to `transferTo` — asked for
  // with the hand-over list first.
  const lockNow = useCallback(
    async (endShift: boolean, transferTo: string | null = null) => {
      if (!terminal && !endShift) {
        setShiftPrompt(null);
        return void writeLocked(true);
      }
      setShiftBusy(true);
      if (terminal) await dropEmpty();
      const result = await lockPos({ endShift, transferTo }).catch(() => ({ ok: false as const, error: UNREACHABLE, signedOut: false, needsHandover: undefined }));
      setShiftBusy(false);
      setShiftPrompt(null);
      if (!result.ok && result.needsHandover) return void setHandover(result.needsHandover);
      setHandover(null);
      if (!result.ok) return void toast.error(result.error);
      if (result.transferred) toast.success(`${result.transferred} ${result.transferred === 1 ? "table" : "tables"} handed over.`);
      if (result.signedOut) return void window.location.replace("/");
      writeLocked(true);
      if (endShift) router.refresh();
    },
    [terminal, dropEmpty, router],
  );
  const lock = useCallback(() => {
    if (!canLock) return void toast.error("Nobody has a PIN yet to open it again. An Administrator sets PINs on Settings › Staff.");
    if (shift.clockOn && shift.onShift) return setShiftPrompt("end");
    void lockNow(false);
  }, [canLock, shift.clockOn, shift.onShift, lockNow]);

  const lockLatest = useRef(lockNow);
  useEffect(() => {
    lockLatest.current = lockNow;
  });
  useEffect(() => {
    if (!autoLock) return;
    // Never in the middle of a payment: while something holds it, it waits
    // for another quiet spell.
    const fire = () => {
      if (holds.current.size > 0) {
        timer = setTimeout(fire, lockSeconds * 1000);
        return;
      }
      void lockLatest.current(false);
    };
    let timer = setTimeout(fire, lockSeconds * 1000);
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(fire, lockSeconds * 1000);
    };
    for (const name of IDLE_EVENTS) window.addEventListener(name, reset, { capture: true, passive: true });
    return () => {
      clearTimeout(timer);
      for (const name of IDLE_EVENTS) window.removeEventListener(name, reset, { capture: true });
    };
  }, [autoLock, lockSeconds]);

  const [cardNotice, setCardNotice] = useState<{ text: string } | null>(null);
  const submit = useCallback(
    async (userId: string | null, pin: string, card: string | null = null): Promise<string | null> => {
      try {
        const result = await switchPosUser(card ? { card } : userId ? { userId, pin } : { pin });
        if (!result.ok) return result.error;
        writeLocked(false);
        setSwitching(false);
        const person = staff.find((p) => p.id === result.userId);
        setWelcome({ name: result.name ?? person?.name ?? "", initials: staffBadge(person?.name ?? result.name ?? "").initials, note: person?.role ?? null });
        if (result.switched) router.refresh();
        if (result.askShift) setShiftPrompt("start");
        return null;
      } catch {
        return "Couldn't reach the server. Check the connection and try again.";
      }
    },
    [router, staff],
  );

  // A staff card held to the reader while the PIN pad is up (Step 7d).
  useScan(
    (code) =>
      void submit(null, "", code).then((problem) => {
        if (problem) setCardNotice({ text: problem });
      }),
    { enabled: switching || locked },
  );

  const open = useCallback(
    (input: { type: "TAKEAWAY" } | { type: "BAR_TAB"; tabName: string }) =>
      startBusy(async () => {
        await dropEmpty();
        const result = await newPosOrder(input).catch(() => ({ ok: false as const, error: "Couldn't reach the server. Check the connection and try again." }));
        if (!result.ok) return void toast.error(result.error);
        setBarTab(false);
        router.push(routes.order(result.orderId));
      }),
    [router, dropEmpty, routes],
  );

  const goTables = useCallback(
    (fromOrderId?: string) =>
      void (async () => {
        const dropped = await dropEmpty();
        router.push(routes.tables({ from: fromOrderId && fromOrderId !== dropped ? fromOrderId : null }));
      })(),
    [router, dropEmpty, routes],
  );
  const exit = useCallback(
    () =>
      void (async () => {
        if (!leaveHref) return;
        await dropEmpty();
        router.push(leaveHref);
      })(),
    [router, dropEmpty, leaveHref],
  );

  // Open drawer: Open Drawer holders straight away, anyone else with the PIN
  // of someone who has it.
  const openDrawer = useCallback(
    (reason: string) =>
      startBusy(async () => {
        const result = await withManager((managerApproval) => openPosDrawer({ reason, managerApproval }).catch(() => ({ ok: false as const, error: "Couldn't reach the server. Check the connection and try again." })), {
          needs: (o) => !o.ok && "needsManager" in o,
          ask: manager.ask,
          title: "Open the drawer — a manager's PIN",
          approvers: drawer?.approvers ?? [],
        });
        if (!result.ok) return void toast.error(result.error);
        setDrawerOpen(false);
        if ("opened" in result && result.opened) toast.success(result.message);
        else if ("message" in result) toast(result.message);
      }),
    [drawer, manager.ask],
  );

  async function startShiftNow() {
    setShiftBusy(true);
    const result = await startMyShift().catch(() => ({ ok: false as const, error: UNREACHABLE }));
    setShiftBusy(false);
    if (!result.ok) return void toast.error(result.error);
    setShiftPrompt(null);
    toast.success("Shift started.");
    router.refresh();
  }

  const value = useMemo<PosSessionValue>(
    () => ({
      userId: user.id,
      userName: user.name,
      busy,
      // The user chip: on a PIN terminal, the same as LOCK (the PIN screen
      // is the switch); elsewhere the PIN pad over the screen.
      openSwitch: terminal ? lock : () => setSwitching(true),
      goTables,
      newTakeaway: () => open({ type: "TAKEAWAY" }),
      openBarTab: () => setBarTab(true),
      askManager: manager.ask,
      openDrawer: drawer ? () => setDrawerOpen(true) : null,
      leaveHref,
      exit,
      markEmpty,
      lock,
      holdAutoLock,
      lightTheme,
    }),
    [user.id, user.name, busy, goTables, open, manager.ask, drawer, leaveHref, exit, markEmpty, lock, holdAutoLock, terminal, lightTheme],
  );

  return (
    <SessionContext.Provider value={value}>
      <style>{PRESSED}</style>
      {/* The theme's colours for everything below (a wrapper that takes no space). */}
      <div data-pos-touch={lightTheme ? "light" : "dark"} style={{ display: "contents", ...touchThemeVars(lightTheme) }}>
      {children}
      {training && (
        <div data-training-banner role="status" style={{ position: "fixed", left: "50%", bottom: 86, transform: "translateX(-50%)", zIndex: 120, background: "#F2B233", color: "#3B2A00", padding: "6px 14px", borderRadius: 999, fontSize: 13, fontWeight: 800, letterSpacing: ".04em", boxShadow: "0 4px 14px rgba(0,0,0,.35)", pointerEvents: "none", whiteSpace: "nowrap" }}>
          TRAINING MODE — nothing goes to the kitchen, nothing is sold
        </div>
      )}
      {barTab && <BarTabDialog busy={busy} onOpen={(tabName) => open({ type: "BAR_TAB", tabName })} onClose={() => setBarTab(false)} />}
      {drawerOpen && <DrawerDialog busy={busy} onOpen={openDrawer} onClose={() => setDrawerOpen(false)} />}
      {manager.element}
      {welcome && <PinWelcome {...welcome} />}
      {(switching || locked) && <PinSwitch staff={staff} withoutPin={withoutPin} locked={locked} currentUserId={user.id} notice={cardNotice} onSubmit={submit} onClose={() => setSwitching(false)} />}
      {shiftPrompt === "end" && (
        <ShiftPrompt
          title="End your shift?"
          detail="Ending it clocks you out. Just lock if you're coming back: your shift stays open."
          busy={shiftBusy}
          choices={[
            { label: "End shift", data: "end", onPick: () => void lockNow(true) },
            { label: "Just lock", data: "lock", tone: "plain", onPick: () => void lockNow(false) },
            { label: "Cancel", data: "cancel", tone: "plain", onPick: () => setShiftPrompt(null) },
          ]}
        />
      )}
      {handover && <HandoverDialog handover={handover} busy={shiftBusy} onHand={(toId) => void lockNow(true, toId)} onClose={() => setHandover(null)} />}
      {shiftPrompt === "start" && !welcome && (
        <ShiftPrompt
          title="Start your shift?"
          detail="Clocks you in now. Your hours and sales count from here."
          busy={shiftBusy}
          choices={[
            { label: "Start shift", data: "start", onPick: () => void startShiftNow() },
            { label: "Not now", data: "later", tone: "plain", onPick: () => setShiftPrompt(null) },
          ]}
        />
      )}
      </div>
    </SessionContext.Provider>
  );
}
