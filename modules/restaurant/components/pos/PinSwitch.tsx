"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { formatAppLongDay, formatAppTime } from "../../lib/time";
import { TOUCH } from "../../lib/theme";
import type { PosStaff } from "../../server/queries/posScreen";
import { staffBadge } from "../../lib/posSpeed";
import { waitText } from "../../lib/pinLockout";
import TouchButton from "./TouchButton";

const PIN_MAX = 6;
// A PIN is 4 to 6 digits: it's checked once typing stops (at once at 6).
const PAUSE_MS = 700;
// Each person's avatar colour, in list order.
export const AVATAR_COLOURS = ["#0F7D6A", "#C2611A", "#2457A6", "#8A3157", "#5E6A1C", "#6B2340", "#1B6676", "#8A4B1F"];
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "Clear", "0", "⌫"];
// A card reader or badge scanner types like a keyboard, far faster than a
// person (Step 7d): desk digits wait this long before they land; digits
// closer together than it are a reader — dropped (the scanner layer reads
// the card), and so is the rest of the burst until it goes quiet.
const BURST_MS = 45;
const BURST_QUIET_MS = 250;

function subscribeTick(onChange: () => void) {
  const timer = setInterval(onChange, 5_000);
  return () => clearInterval(timer);
}
function subscribeSecond(onChange: () => void) {
  const timer = setInterval(onChange, 1_000);
  return () => clearInterval(timer);
}
const noTick = () => () => undefined;
const zero = () => 0;
function subscribeOnline(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

// Who's on the till (the PIN Login design), over the whole screen: the time
// and who's on shift on the left; the PIN pad on the right. Typing a PIN
// is enough — it finds its person (tapping your name first is optional,
// and needed only when two people share a PIN). As a manager's approval
// (`title`: "Void Chk Puff — a manager's PIN") the manager taps their name,
// then types. Locked, there's no way round it. A desk keyboard types too.
// As the sign-in screen of a PIN terminal (Part 6f Step 4: `signIn`), a PIN
// is checked the moment its 4th digit is typed, the names can be hidden, and
// a device locked out by wrong PINs (`heldUntil`) counts down.
export default function PinSwitch({
  staff,
  withoutPin,
  locked,
  currentUserId,
  title,
  emptyText = "Nobody has a PIN yet. An Administrator sets them on Settings › Staff.",
  signIn = false,
  hideNames = false,
  heldUntil = null,
  badge = "RESTAURANT",
  cards = false,
  notice = null,
  onSubmit,
  onClose,
}: {
  staff: PosStaff[];
  withoutPin: number;
  locked: boolean;
  currentUserId: string;
  // A manager's PIN (voids, refunds…): "Void Chk Puff — a manager's PIN".
  title?: string;
  emptyText?: string;
  // The PIN terminal's sign-in: 4 digits, checked at once.
  signIn?: boolean;
  // No "on shift" list (Settings › Staff).
  hideNames?: boolean;
  // Locked out until then (ms): the pad waits, counting down.
  heldUntil?: number | null;
  // The chip by the name: RESTAURANT, or what a paired device is (Step 7c).
  badge?: string;
  // Staff cards are in use (Step 7d): the hint says a card works too.
  cards?: boolean;
  // A message from outside the pad (a card that didn't sign in), shown as
  // its error; a new object each time.
  notice?: { text: string } | null;
  // userId null: the PIN alone (not for an approval). Resolves to an error
  // to show, or null when it worked.
  onSubmit: (userId: string | null, pin: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const approving = !!title;
  const [picked, setPicked] = useState<PosStaff | null>(approving && staff.length === 1 ? staff[0] : null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const clock = useSyncExternalStore(subscribeTick, () => formatAppTime(new Date()), () => "");
  const day = useSyncExternalStore(subscribeTick, () => formatAppLongDay(new Date()), () => "");
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const host = useSyncExternalStore(subscribeTick, () => window.location.hostname, () => "");
  // Seconds the device still waits, read again every second.
  const heldFor = useSyncExternalStore(heldUntil ? subscribeSecond : noTick, () => (heldUntil ? Math.max(0, Math.ceil((heldUntil - Date.now()) / 1000)) : 0), zero);
  const held = heldFor > 0;
  const maxDigits = signIn ? 4 : PIN_MAX;
  // A card's answer, shown like a wrong PIN.
  const [lastNotice, setLastNotice] = useState(notice);
  if (notice !== lastNotice) {
    setLastNotice(notice);
    if (notice) setError(notice.text);
  }
  const latest = useRef({ picked, pin, busy: busy || held });
  useEffect(() => {
    latest.current = { picked, pin, busy: busy || held };
  });

  async function submit() {
    const { picked: person, pin: typed, busy: working } = latest.current;
    if (typed.length < 4 || working) return;
    if (approving && !person) return setError("Tap your name first, then your PIN.");
    setBusy(true);
    setError(null);
    const problem = await onSubmit(person?.id ?? null, typed);
    // The PIN is cleared either way, so it isn't checked again; signing in,
    // the pad stays busy until the home screen loads.
    setPin("");
    if (problem) {
      setBusy(false);
      setError(problem);
    } else if (!signIn) setBusy(false);
  }

  // Checked once typing stops: a 4-digit PIN after a moment, 6 at once —
  // or, signing in, the 4th digit at once.
  const submitRef = useRef(submit);
  useEffect(() => {
    submitRef.current = submit;
  });
  useEffect(() => {
    if (pin.length < 4 || busy || held) return;
    const timer = setTimeout(() => void submitRef.current(), pin.length >= maxDigits ? 0 : PAUSE_MS);
    return () => clearTimeout(timer);
  }, [pin, busy, held, maxDigits]);

  function press(key: string) {
    if (latest.current.busy) return;
    setError(null);
    if (key === "⌫") setPin((p) => p.slice(0, -1));
    else if (key === "Clear") {
      setPin("");
      if (!approving || staff.length > 1) setPicked(null);
    } else setPin((p) => (p.length < maxDigits ? p + key : p));
  }

  // Desk keys: digits, Backspace, Enter (check now); Esc clears the name,
  // then closes (unless locked).
  const keys = useRef({ press, submit, close: onClose });
  useEffect(() => {
    keys.current = { press, submit, close: onClose };
  });
  useEffect(() => {
    const burst = { last: 0, pending: [] as string[], timer: null as ReturnType<typeof setTimeout> | null, until: 0 };
    function onKey(event: KeyboardEvent) {
      if (/^\d$/.test(event.key)) {
        const t = event.timeStamp || performance.now();
        const gap = t - burst.last;
        burst.last = t;
        event.preventDefault();
        event.stopPropagation();
        if (t < burst.until || (burst.pending.length && gap < BURST_MS)) {
          // A reader: none of it is a PIN.
          burst.pending = [];
          if (burst.timer) clearTimeout(burst.timer);
          burst.until = t + BURST_QUIET_MS;
          return;
        }
        burst.pending.push(event.key);
        if (burst.timer) clearTimeout(burst.timer);
        burst.timer = setTimeout(() => {
          for (const k of burst.pending) keys.current.press(k);
          burst.pending = [];
        }, BURST_MS);
        return;
      }
      if (event.key === "Enter" && (event.timeStamp || performance.now()) < burst.until) return;
      if (event.key === "Backspace") keys.current.press("⌫");
      else if (event.key === "Enter") void keys.current.submit();
      else if (event.key === "Escape") {
        if (latest.current.picked || latest.current.pin) keys.current.press("Clear");
        else if (!locked) keys.current.close();
      } else return;
      event.preventDefault();
      event.stopPropagation();
    }
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      if (burst.timer) clearTimeout(burst.timer);
    };
  }, [locked]);

  const heading = picked ? picked.name : approving ? title : "Enter your PIN";
  const subtitle = held ? waitText(heldFor) : (error ?? (picked ? "Enter your PIN" : approving ? "Tap your name, then your PIN" : cards ? "Your PIN or your staff card logs you in." : "Your PIN logs you in. No name needed."));
  const showError = held || !!error;
  const dots = Math.max(4, pin.length);

  return (
    <div
      role="dialog"
      aria-label={signIn ? "Sign in" : locked ? "Locked" : (title ?? "Switch user")}
      data-pin-switch={signIn ? "signin" : locked ? "locked" : approving ? "approve" : "switch"}
      style={{ position: "fixed", inset: 0, zIndex: 200, background: TOUCH.frame, color: TOUCH.text, display: "grid", gridTemplateColumns: "minmax(0,1fr) min(520px, 48%)", userSelect: "none", lineHeight: "normal" }}
    >
      <section style={{ display: "flex", flexDirection: "column", gap: 32, padding: "40px 48px", borderRight: `1px solid ${TOUCH.line}`, minWidth: 0, minHeight: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontFamily: TOUCH.display, fontWeight: 700, fontSize: 24 }}>RingzPOS</span>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".08em", color: TOUCH.doneInk, background: TOUCH.doneBg, padding: "3px 7px", borderRadius: 3 }} data-pin-badge>
            {badge}
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 40 }}>
          <span data-pin-clock style={{ fontFamily: TOUCH.display, fontSize: 96, fontWeight: 700, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
            {clock}
          </span>
          <span style={{ fontSize: 20, color: TOUCH.textDim }}>{day}</span>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", flexDirection: "column", gap: 10, minHeight: 0 }}>
          {!hideNames && <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".08em", color: TOUCH.muted }}>{approving ? "WHO CAN APPROVE" : "ON SHIFT"}</span>}
          {hideNames ? (
            <span data-pin-names-hidden style={{ fontSize: 15, color: TOUCH.textDim }}>
              Type your PIN to sign in.
            </span>
          ) : staff.length === 0 ? (
            <span style={{ fontSize: 15, color: TOUCH.textDim }}>{emptyText}</span>
          ) : (
            <div data-pin-staff style={{ display: "flex", gap: 8, flexWrap: "wrap", overflowY: "auto", maxHeight: 200 }}>
              {staff.map((person, i) => {
                const on = picked?.id === person.id;
                return (
                  <TouchButton
                    key={person.id}
                    data-staff={person.name}
                    aria-pressed={on}
                    background={on ? TOUCH.keyDown : TOUCH.key}
                    onClick={() => {
                      setPicked(on ? null : person);
                      setPin("");
                      setError(null);
                    }}
                    style={{ height: 56, display: "flex", alignItems: "center", gap: 10, padding: "0 16px 0 8px", fontSize: 15, fontWeight: 600 }}
                  >
                    <span aria-hidden style={{ width: 40, height: 40, borderRadius: "50%", background: person.colour || AVATAR_COLOURS[i % AVATAR_COLOURS.length], display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, flexShrink: 0 }}>
                      {staffBadge(person.name).initials}
                    </span>
                    <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 1 }}>
                      <span>
                        {person.name}
                        {person.id === currentUserId ? " (on the till)" : ""}
                      </span>
                      {person.role && <span style={{ fontSize: 12, fontWeight: 500, color: TOUCH.textDim }}>{person.role}</span>}
                    </span>
                  </TouchButton>
                );
              })}
            </div>
          )}
          {withoutPin > 0 && (
            <span style={{ fontSize: 13, color: TOUCH.muted }}>
              {withoutPin} more {withoutPin === 1 ? "person takes" : "people take"} orders without a PIN — an Administrator sets it on Settings › Staff.
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 20, fontSize: 14, color: TOUCH.textDim }}>
          <span data-pin-connection style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span aria-hidden style={{ width: 8, height: 8, borderRadius: "50%", background: online ? TOUCH.ok : TOUCH.fault }} />
            {online ? `Connected to server${host ? ` · ${host}` : ""}` : "Offline — check the network"}
          </span>
        </div>
      </section>

      <section style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 22, padding: 32, background: TOUCH.header, minWidth: 0 }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, minHeight: 58, textAlign: "center" }}>
          <span data-pin-title style={{ fontFamily: TOUCH.display, fontSize: 26, fontWeight: 700 }}>
            {heading}
          </span>
          <span role="alert" data-pin-error={showError ? "" : undefined} data-pin-held={held ? heldFor : undefined} style={{ fontSize: 15, fontWeight: 500, color: showError ? TOUCH.dangerText : TOUCH.textDim }}>
            {busy ? "Checking…" : subtitle}
          </span>
        </div>
        <div data-pin-dots aria-label={`${pin.length} digits typed`} style={{ display: "flex", gap: 18, height: 24, alignItems: "center" }}>
          {Array.from({ length: dots }, (_, i) => (
            <span
              key={i}
              style={{ width: 20, height: 20, borderRadius: "50%", background: error ? "#E5484D" : i < pin.length ? TOUCH.text : "transparent", boxShadow: error ? "none" : `inset 0 0 0 2px ${TOUCH.muted}` }}
            />
          ))}
        </div>
        <div role="group" aria-label="PIN pad" style={{ display: "grid", gridTemplateColumns: "repeat(3, 104px)", gridAutoRows: 84, gap: 10, marginTop: 6, opacity: held ? 0.4 : 1, transition: "opacity .2s" }}>
          {KEYS.map((key) => (
            <TouchButton
              key={key}
              data-pin-key={key}
              aria-label={key === "⌫" ? "Delete a digit" : key}
              background={key === "Clear" || key === "⌫" ? TOUCH.key : TOUCH.pinKey}
              color={key === "Clear" ? TOUCH.textDim : TOUCH.text}
              pressedBackground={TOUCH.keyDown}
              disabled={busy || held}
              onClick={() => press(key)}
              style={{ fontFamily: TOUCH.display, fontSize: key === "Clear" ? 17 : 30, fontWeight: 700 }}
            >
              {key}
            </TouchButton>
          ))}
        </div>
        {!locked && (
          <TouchButton data-pin-close background={TOUCH.cancel} color={TOUCH.dangerText} onClick={onClose} style={{ height: 48, padding: "0 28px", fontSize: 15, fontWeight: 700 }}>
            Cancel
          </TouchButton>
        )}
      </section>
    </div>
  );
}

// After a PIN signs someone in: the PIN Login design's teal welcome, for a
// moment.
export function PinWelcome({ name, initials, note }: { name: string; initials: string; note: string | null }) {
  return (
    <div data-pin-welcome style={{ position: "fixed", inset: 0, zIndex: 210, background: TOUCH.teal, color: "#fff", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, lineHeight: "normal" }}>
      <span aria-hidden style={{ width: 96, height: 96, borderRadius: "50%", background: "rgba(0,0,0,.2)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: TOUCH.display, fontSize: 36, fontWeight: 700 }}>
        {initials}
      </span>
      <span style={{ fontFamily: TOUCH.display, fontSize: 40, fontWeight: 700 }}>Welcome, {name}</span>
      {note && <span style={{ fontSize: 18, color: "#D9F2EC" }}>{note}</span>}
    </div>
  );
}
