"use client";

import { useEffect, useRef, useState } from "react";
import ScanProvider, { useScan } from "@/components/hardware/ScanProvider";
import { signInByPin } from "../../server/actions/pinSignIn";
import { startMyShift } from "../../server/actions/session";
import { T } from "./tabletTheme";
import { useTabletClock } from "./useTabletClock";
import { useTabletConnection } from "./useTabletConnection";

// The tablet's PIN login (Part 6g Step 2, design: RingzPOS Tablet.dc.html ›
// Tablet Login). The 4th digit signs in — no Enter. A wrong PIN turns the
// dots red: "Wrong PIN · try again". Everything else is the PIN sign-in's
// own (Part 6f): the device must be a paired terminal, wrong PINs lock it
// for a while (the pad waits, counting down), every attempt is logged, and
// the person lands on their role's home screen. With clock in / out on,
// someone not on shift is asked "Start shift?" first. A hardware keyboard
// types the PIN too, and a staff card held to the reader signs in like it.

const UNREACHABLE = "Couldn't reach the server. Check the connection and try again.";
// The PIN sign-in's own answer for a wrong PIN (services/approvalPins).
const WRONG = "That PIN isn't right.";
// A 4th digit typed on a keyboard waits this long: a card reader types fast
// and ends in Enter — that's a scan, not a PIN.
const KEYBOARD_SETTLE_MS = 150;
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "CLEAR", "0", "⌫"] as const;

type Props = { deviceName: string; areaName: string | null; kind: "POS" | "KITCHEN" | "BAR" };

export default function TabletPinLogin(props: Props) {
  return (
    <ScanProvider>
      <Pad {...props} />
    </ScanProvider>
  );
}

function Pad({ deviceName, areaName, kind }: Props) {
  const clock = useTabletClock();
  const { online: serverUp } = useTabletConnection();
  const [pin, setPinState] = useState("");
  // The digits so far, read straight away (a card reader's keys can come
  // faster than the screen redraws).
  const pinRef = useRef("");
  const setPin = (next: string) => {
    pinRef.current = next;
    setPinState(next);
  };
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [heldUntil, setHeldUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [welcome, setWelcome] = useState<string | null>(null);
  const [askShift, setAskShift] = useState<{ home: string } | null>(null);
  const [starting, setStarting] = useState(false);
  const settle = useRef<number | null>(null);

  const waitLeft = heldUntil ? Math.max(0, Math.ceil((heldUntil - now) / 1000)) : 0;
  const held = waitLeft > 0;
  const locked = busy || held || !!welcome || !!askShift;

  // The countdown while the pad is held.
  useEffect(() => {
    if (!heldUntil) return;
    const timer = window.setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= heldUntil) {
        setHeldUntil(null);
        setError(null);
      }
    }, 250);
    return () => window.clearInterval(timer);
  }, [heldUntil]);

  async function signIn(input: { userId: null; pin: string } | { card: string }) {
    setBusy(true);
    const result = await signInByPin(input).catch(() => ({ ok: false as const, error: UNREACHABLE, waitSeconds: undefined }));
    setBusy(false);
    setPin("");
    if (!result.ok) {
      setError(result.error.startsWith(WRONG) ? "Wrong PIN · try again" : result.error);
      if (result.waitSeconds) {
        setNow(Date.now());
        setHeldUntil(Date.now() + result.waitSeconds * 1000);
      }
      return;
    }
    setError(null);
    setWelcome(result.name);
    // A full page load, so every screen sees the new session.
    window.setTimeout(() => {
      if (result.askShift) {
        setWelcome(null);
        setAskShift({ home: result.home });
      } else window.location.replace(result.home);
    }, 600);
  }

  function press(key: (typeof KEYS)[number], fromKeyboard = false) {
    if (locked) return;
    if (settle.current) {
      // More keys right after a 4th: a card reader, not a person.
      window.clearTimeout(settle.current);
      settle.current = null;
      setPin("");
      return;
    }
    if (key === "CLEAR") return void (setPin(""), setError(null));
    if (key === "⌫") return void setPin(pinRef.current.slice(0, -1));
    setError(null);
    const next = (pinRef.current + key).slice(0, 4);
    setPin(next);
    if (next.length < 4) return;
    if (!fromKeyboard) return void signIn({ userId: null, pin: next });
    settle.current = window.setTimeout(() => {
      settle.current = null;
      void signIn({ userId: null, pin: next });
    }, KEYBOARD_SETTLE_MS);
  }

  // A hardware keyboard: digits, Backspace, Escape (clear).
  const pressRef = useRef(press);
  useEffect(() => {
    pressRef.current = press;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (/^[0-9]$/.test(e.key)) pressRef.current(e.key as (typeof KEYS)[number], true);
      else if (e.key === "Backspace") pressRef.current("⌫", true);
      else if (e.key === "Escape") pressRef.current("CLEAR", true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // A staff card: the same as a PIN.
  useScan((code) => {
    if (settle.current) window.clearTimeout(settle.current);
    settle.current = null;
    setPin("");
    if (busy || welcome || askShift) return;
    void signIn({ card: code });
  });

  async function startShift(home: string) {
    setStarting(true);
    const result = await startMyShift().catch(() => ({ ok: false as const, error: UNREACHABLE }));
    setStarting(false);
    // Signed in either way: a failure here doesn't keep them off the floor.
    if (!result.ok) window.alert(result.error);
    window.location.replace(home);
  }

  const red = !!error && !held;
  const title = welcome ? `Welcome, ${welcome}` : kind === "KITCHEN" ? "Kitchen · enter your PIN" : "Enter your PIN";
  return (
    <div data-tablet-login style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", padding: "40px 48px 36px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 26, fontWeight: 900, letterSpacing: "-.01em" }}>RingzPOS</span>
        <span data-tablet-clock style={{ fontSize: 30, fontWeight: 800, minWidth: 90, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
          {clock ?? ""}
        </span>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 28 }}>
        <span data-pin-title style={{ fontSize: 44, fontWeight: 900, textAlign: "center" }}>
          {title}
        </span>
        <div data-pin-dots={pin.length} data-pin-error={red ? "" : undefined} style={{ display: "flex", gap: 28 }} aria-label={`${pin.length} of 4 digits`}>
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              style={{ width: 34, height: 34, borderRadius: "50%", boxSizing: "border-box", border: `4px solid ${red ? T.danger : welcome ? T.ok : T.text}`, background: red ? T.danger : welcome ? T.ok : i < pin.length ? T.text : "transparent" }}
            />
          ))}
        </div>
        <span data-pin-error-text role="alert" style={{ minHeight: 26, fontSize: 20, fontWeight: 700, color: held ? T.lockFg : T.danger, textAlign: "center" }}>
          {held ? `Too many attempts · wait ${waitLeft} s` : (error ?? "")}
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gridAutoRows: "min(132px, 11vh)", gap: 12, opacity: held ? 0.4 : 1 }}>
        {KEYS.map((key) => {
          const side = key === "CLEAR" || key === "⌫";
          return (
            <button
              key={key}
              type="button"
              className="tb-press"
              data-pin-key={key}
              aria-label={key === "⌫" ? "Delete" : key === "CLEAR" ? "Clear" : key}
              disabled={locked}
              onClick={() => press(key)}
              style={{ border: "none", borderRadius: 8, background: side ? T.raised : T.buttonAlt, color: T.text, fontSize: key === "CLEAR" ? 22 : 52, fontWeight: 800, fontFamily: "inherit", cursor: locked ? "default" : "pointer" }}
            >
              {key}
            </button>
          );
        })}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, marginTop: 24, fontSize: 17, fontWeight: 600, color: T.quiet }}>
        <span data-server-status={serverUp ? "up" : "down"} style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 12, height: 12, borderRadius: "50%", background: serverUp ? T.ok : "#C81E1E" }} />
          {serverUp ? "Server connected" : "Can't reach server, retrying…"}
        </span>
        <span data-tablet-device style={{ textAlign: "right" }}>
          {deviceName}
          {areaName ? ` · ${areaName}` : ""}
        </span>
      </div>

      {askShift && (
        <div data-shift-prompt style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,.7)", display: "flex", alignItems: "flex-end" }}>
          <div style={{ width: "100%", background: T.raised, borderRadius: "18px 18px 0 0", padding: "28px 24px 32px", display: "flex", flexDirection: "column", gap: 18 }}>
            <span style={{ fontSize: 34, fontWeight: 900 }}>Start your shift?</span>
            <span style={{ fontSize: 20, fontWeight: 700, color: T.quiet }}>Clocks you in now. Your hours and sales count from here.</span>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <button type="button" className="tb-press" data-shift="later" disabled={starting} onClick={() => window.location.replace(askShift.home)} style={{ height: 112, border: "none", borderRadius: 8, background: T.bar, color: T.soft, fontSize: 24, fontWeight: 900, fontFamily: "inherit" }}>
                Not now
              </button>
              <button type="button" className="tb-press" data-shift="start" disabled={starting} onClick={() => void startShift(askShift.home)} style={{ height: 112, border: "none", borderRadius: 8, background: T.teal, color: T.text, fontSize: 24, fontWeight: 900, fontFamily: "inherit" }}>
                {starting ? "Starting…" : "Start shift"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Not paired as a PIN terminal: the PIN sign-in can't work here.
export function TabletNotPaired() {
  return (
    <div data-tablet-not-paired style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", padding: "40px 48px 36px" }}>
      <span style={{ fontSize: 26, fontWeight: 900 }}>RingzPOS</span>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 22 }}>
        <span style={{ fontSize: 40, fontWeight: 900, lineHeight: 1.1 }}>This tablet isn&apos;t set up for PIN sign-in yet</span>
        <span style={{ fontSize: 21, fontWeight: 700, color: T.quiet, lineHeight: 1.4 }}>An Administrator pairs it once: on this tablet, sign in with email, open Settings › Devices and set “Paired as” to PIN terminal (or Bar terminal, or Kitchen screen).</span>
        {/* A full page load: the email sign-in. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- leaves the tablet screens on purpose */}
        <a href="/" className="tb-press" data-email-sign-in style={{ alignSelf: "flex-start", height: 84, padding: "0 32px", display: "flex", alignItems: "center", borderRadius: 8, background: T.buttonAlt, color: T.text, fontSize: 22, fontWeight: 900, textDecoration: "none" }}>
          Sign in with email
        </a>
      </div>
    </div>
  );
}
