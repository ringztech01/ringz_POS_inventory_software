"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { useRouter } from "next/navigation";
import { Calculator, Check, ChevronDown, ChevronsRight, Delete, Equal, ListChecks, Minus, Plus, RefreshCw, RotateCcw, Split, Undo2, UserMinus, X } from "lucide-react";
import { COLORS, FONTS } from "@/components/layout/theme";
import { formatNaira } from "@/lib/format";
import { splitByAmounts, splitEqually } from "../../lib/billSplit";
import {
  assignUnit,
  buildCards,
  emptyUnits,
  fromParts,
  guestItemsKobo,
  reconcile,
  removeGuest,
  restTo,
  returnUnit,
  shareUnit,
  splitEven,
  toParts,
  unassigned,
  type Units,
} from "../../lib/splitAssign";
import type { BillSplit } from "../../schemas/bill";
import type { BillView } from "../../server/queries/bill";

// Split bill (Bill panel › Split bill) — built for a waiter's thumbs
// (RingzPOS Split Bill.dc.html):
//
//   By item    pick a guest (chips on top, each with its running total), tap
//              their items — one unit a tap. Tap a guest's total to see and
//              return their items, or remove them. "Rest to Guest N" gives
//              everything left in one tap; long-press a card (or its split
//              button) to share it evenly. Nothing is red while working: a
//              neutral progress line, and a button that says what's next.
//   Equal      a big guest-count stepper and the live list
//   By amount  a keypad per guest; the last pays the rest
//
// The amounts shown are a preview; the server works out and saves the
// parts, to the kobo, with any rounding on the last. The mode used last on
// this tablet opens first; Edit split reopens with the assignments kept.

export type SplitOutcome = { ok: true } | { ok: false; error: string; stale?: boolean };
type Mode = BillSplit["mode"];
type Sheet = { type: "guest"; id: number } | { type: "share"; key: string; picked: number[] } | { type: "reset" };
type Snapshot = { guests: number[]; nextId: number; active: number; units: Units };

const MODE_KEY = "ringz_split_mode";
const MAX_GUESTS = 20;
const UNDO_MS = 4000;
const LONG_PRESS_MS = 450;
export const GUEST_COLORS = ["#0f7d6a", "#1d5fa8", "#c2410c", "#7c3aed", "#b45309", "#be185d", "#0e7490", "#4d7c0f"];
const FRACTION: Record<number, string> = { 2: "½", 3: "⅓", 4: "¼", 5: "⅕", 6: "⅙", 8: "⅛" };
export const colorOf = (id: number) => GUEST_COLORS[(id - 1) % GUEST_COLORS.length];
const share = (n: number) => FRACTION[n] ?? `1/${n}`;
const kobo = (value: string) => Math.round(Number(value) * 100);
const naira = (k: number) => formatNaira((k / 100).toFixed(2));
const nairaWhole = (k: number) => `₦${Math.round(k / 100).toLocaleString("en-NG")}`;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const NUM: CSSProperties = { fontVariantNumeric: "tabular-nums" };

function readMode(): Mode | null {
  try {
    const m = window.localStorage.getItem(MODE_KEY);
    return m === "ITEMS" || m === "EQUAL" || m === "AMOUNT" ? m : null;
  } catch {
    return null;
  }
}
function saveMode(mode: Mode) {
  try {
    window.localStorage.setItem(MODE_KEY, mode);
  } catch {
    // Storage blocked: the default next time.
  }
}

function Dot({ id, n, size = 30 }: { id: number; n: number | string; size?: number }) {
  return (
    <span style={{ width: size, height: size, flex: "0 0 auto", borderRadius: size / 2, background: colorOf(id), color: "#fff", fontSize: size > 26 ? 13 : 11.5, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", ...NUM }}>{n}</span>
  );
}

export default function SplitModal({ bill, onSubmit, onClose }: { bill: BillView; onSubmit: (split: BillSplit) => Promise<SplitOutcome>; onClose: () => void }) {
  const router = useRouter();
  const cards = useMemo(() => buildCards(bill.lines), [bill.lines]);
  const totalKobo = kobo(bill.totals.totalValue);
  const itemsKobo = cards.reduce((k, c) => k + c.qty * c.unitKobo, 0);
  const editing = bill.split && bill.split.parts.every((p) => p.status === "OPEN") ? bill.split : null;

  // ---- state (Edit split: as saved; otherwise a fresh split in the last mode)
  const [start] = useState(() => {
    const saved = editing?.mode === "ITEMS" ? fromParts(cards, editing.parts) : null;
    return {
      mode: (editing?.mode ?? readMode() ?? "ITEMS") as Mode,
      guests: saved?.guests ?? [1, 2],
      units: saved?.units ?? emptyUnits(cards),
      ways: editing?.mode === "EQUAL" ? editing.parts.length : clamp(bill.order.guests, 2, MAX_GUESTS),
      amounts: editing?.mode === "AMOUNT" ? editing.parts.slice(0, -1).map((p) => String(Number(p.amountValue))) : [],
      amtCount: editing?.mode === "AMOUNT" ? editing.parts.length : clamp(bill.order.guests, 2, MAX_GUESTS),
    };
  });
  const [mode, setMode] = useState<Mode>(start.mode);
  const [guests, setGuests] = useState<number[]>(start.guests);
  const [nextId, setNextId] = useState(Math.max(...start.guests) + 1);
  const [active, setActive] = useState(start.guests[0]);
  const [rawUnits, setUnits] = useState<Units>(start.units);
  const units = useMemo(() => reconcile(rawUnits, cards), [rawUnits, cards]);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [toast, setToast] = useState<{ text: string; undo: Snapshot } | null>(null);
  const [ways, setWays] = useState(start.ways);
  const [amtCount, setAmtCount] = useState(start.amtCount);
  const [amounts, setAmounts] = useState<string[]>(start.amounts);
  const [amtActive, setAmtActive] = useState(0);
  const [saving, setSaving] = useState(false);
  const [refusal, setRefusal] = useState<{ error: string; stale: boolean } | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressed = useRef(false);

  useEffect(() => () => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
  }, []);
  // The undo toast goes after UNDO_MS (a new one starts the clock again).
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), UNDO_MS);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (sheet) setSheet(null);
      else onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, sheet]);

  const name = (id: number) => `Guest ${guests.indexOf(id) + 1}`;
  const snapshot = (): Snapshot => ({ guests, nextId, active, units });
  const say = useCallback((text: string, undo: Snapshot) => setToast({ text, undo }), []);
  const undo = () => {
    if (!toast) return;
    setGuests(toast.undo.guests);
    setNextId(toast.undo.nextId);
    setActive(toast.undo.active);
    setUnits(toast.undo.units);
    setToast(null);
  };

  // ---- By item actions
  const left = unassigned(units, cards);
  const complete = left.count === 0;
  const items = guestItemsKobo(units, cards, guests);
  // The preview: each guest's items scaled to the bill (discount, service,
  // tax); the last takes the rest once everything is assigned.
  const preview: Record<number, number> = {};
  let given = 0;
  guests.forEach((g, i) => {
    if (complete && i === guests.length - 1) preview[g] = totalKobo - given;
    else {
      preview[g] = itemsKobo ? Math.round((items[g] * totalKobo) / itemsKobo) : 0;
      given += preview[g];
    }
  });
  const emptyGuest = guests.find((g) => items[g] === 0);

  function tapCard(key: string) {
    if (pressed.current) {
      pressed.current = false;
      return;
    }
    const next = assignUnit(units, key, active);
    if (!next) return;
    const before = snapshot();
    setUnits(next);
    say(`Gave ${cards.find((c) => c.key === key)!.name} to ${name(active)}`, before);
  }
  function giveRest() {
    const { units: next, count } = restTo(units, active);
    if (!count) return;
    const before = snapshot();
    setUnits(next);
    say(`Gave the rest (${count} item${count === 1 ? "" : "s"}) to ${name(active)}`, before);
  }
  function addGuest() {
    if (guests.length >= MAX_GUESTS) return;
    setGuests([...guests, nextId]);
    setActive(nextId);
    setNextId(nextId + 1);
  }
  function dropGuest(id: number) {
    if (guests.length <= 2) return;
    const before = snapshot();
    const rest = guests.filter((g) => g !== id);
    setUnits(removeGuest(units, id));
    setGuests(rest);
    if (active === id) setActive(rest[0]);
    setSheet(null);
    say(`Removed ${name(id)} — their items are unassigned`, before);
  }
  function giveBack(key: string, index: number, guest: number) {
    const before = snapshot();
    setUnits(returnUnit(units, key, index, guest));
    say(`Returned ${cards.find((c) => c.key === key)!.name} from ${name(guest)}`, before);
  }
  function shareIt(key: string, picked: number[]) {
    const who = guests.filter((g) => picked.includes(g));
    const next = shareUnit(units, key, who);
    if (!next) return;
    const before = snapshot();
    setUnits(next);
    setSheet(null);
    say(`Shared ${cards.find((c) => c.key === key)!.name} · ${share(who.length)} each`, before);
  }
  const pressStart = (key: string) => (event: ReactPointerEvent) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    pressed.current = false;
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = setTimeout(() => {
      pressed.current = true;
      if ((units[key] ?? []).includes(null)) setSheet({ type: "share", key, picked: [] });
    }, LONG_PRESS_MS);
  };
  const pressEnd = () => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
  };

  // ---- Equal / By amount previews
  const equal = splitEqually(bill.totals.totalValue, ways);
  const typed = Array.from({ length: amtCount - 1 }, (_, i) => amounts[i] ?? "");
  const typedKobo = typed.map((v) => kobo(v || "0"));
  const lastKobo = totalKobo - typedKobo.reduce((a, b) => a + b, 0);
  const byAmount = typed.every((v) => /^\d{1,10}(\.\d{1,2})?$/.test(v)) ? splitByAmounts(bill.totals.totalValue, typed) : null;
  function press(key: string) {
    setAmounts((current) => {
      const next = Array.from({ length: amtCount - 1 }, (_, i) => current[i] ?? "");
      const cur = next[amtActive] ?? "";
      next[amtActive] = key === "back" ? cur.slice(0, -1) : (cur + key).replace(/^0+(?=\d)/, "").slice(0, 9);
      return next;
    });
  }
  function remainderEqually() {
    const blanks = typed.map((v, i) => (Number(v || 0) > 0 ? -1 : i)).filter((i) => i >= 0);
    if (!blanks.length || lastKobo <= 0) return;
    const shares = splitEven(lastKobo, blanks.length + 1);
    setAmounts(typed.map((v, i) => (blanks.includes(i) ? (shares[blanks.indexOf(i)] / 100).toFixed(2).replace(/\.00$/, "") : v)));
  }

  // ---- The button: always says what's next
  let label = "";
  let note = "";
  let ready = false;
  if (bill.settleBlocker) {
    label = "Can't split yet";
    note = bill.settleBlocker;
  } else if (refusal?.stale) {
    label = "Reload the bill to continue";
    note = "Nothing was saved — the bill changed first.";
  } else if (mode === "ITEMS") {
    if (!complete) {
      label = `Assign ${left.count} more item${left.count === 1 ? "" : "s"}`;
      note = "Tap items to give them to the picked guest.";
    } else if (emptyGuest) {
      label = `${name(emptyGuest)} has nothing yet`;
      note = `Give ${name(emptyGuest)} an item, or tap their total to remove them.`;
    } else {
      ready = true;
      label = `Split into ${guests.length} bills · ${bill.totals.total}`;
      note = "Each guest then pays on their own from the bill.";
    }
  } else if (mode === "EQUAL") {
    ready = equal.ok;
    label = equal.ok ? `Split into ${ways} bills · ${bill.totals.total}` : equal.error;
    note = equal.ok ? `${ways} × about ${formatNaira(equal.amounts[0].toFixed(2))}` : "";
  } else {
    if (lastKobo < 0) {
      label = `Lower an amount by ${naira(-lastKobo)}`;
      note = "The amounts are more than the bill.";
    } else if (!byAmount || !byAmount.ok) {
      label = "Enter each guest's amount";
      note = "Every guest needs an amount above ₦0 — or use “Split remainder equally”.";
    } else {
      ready = true;
      label = `Split into ${amtCount} bills · ${bill.totals.total}`;
      note = `The last guest pays the rest: ${naira(lastKobo)}.`;
    }
  }
  ready = ready && !saving;

  async function submit() {
    if (!ready) return;
    const split: BillSplit =
      mode === "EQUAL" ? { mode, ways }
      : mode === "AMOUNT" ? { mode, amounts: typed }
      : { mode, parts: toParts(units, cards, guests) };
    setSaving(true);
    setRefusal(null);
    const outcome = await onSubmit(split);
    setSaving(false);
    if (outcome.ok) {
      saveMode(mode);
      onClose();
    } else setRefusal({ error: outcome.error, stale: !!outcome.stale });
  }
  function pickMode(next: Mode) {
    setMode(next);
    saveMode(next);
  }

  // ---- Sheets
  const sheetBody = (() => {
    if (!sheet) return null;
    if (sheet.type === "reset")
      return {
        title: "Clear all assignments?",
        amount: "",
        hint: "The guests stay; every item goes back to unassigned. You can undo this.",
        body: null,
        secondary: { label: "Keep them", onClick: () => setSheet(null) },
        primary: { label: "Clear all", danger: true, enabled: true, onClick: () => { const before = snapshot(); setUnits(emptyUnits(cards)); setSheet(null); say("Cleared all assignments", before); } },
      };
    if (sheet.type === "share") {
      const card = cards.find((c) => c.key === sheet.key);
      if (!card) return null;
      const n = sheet.picked.length;
      return {
        title: `Share ${card.name}`,
        amount: naira(card.unitKobo),
        hint: n >= 2 ? `${share(n)} each: ${splitEven(card.unitKobo, n).map(naira).join(" + ")} (rounding on the last)` : "Tap the guests sharing it — 2 or more.",
        body: (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {guests.map((g, i) => {
              const on = sheet.picked.includes(g);
              return (
                <button
                  key={g}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setSheet({ ...sheet, picked: on ? sheet.picked.filter((x) => x !== g) : [...sheet.picked, g] })}
                  style={{ height: 48, padding: "0 14px 0 6px", borderRadius: 24, border: `2px solid ${on ? colorOf(g) : COLORS.borderStrong}`, background: on ? `${colorOf(g)}14` : "#fff", cursor: "pointer", display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 600, color: COLORS.ink }}
                >
                  <Dot id={g} n={i + 1} />
                  Guest {i + 1}
                  <Check size={16} strokeWidth={2.4} color={colorOf(g)} style={{ opacity: on ? 1 : 0 }} />
                </button>
              );
            })}
          </div>
        ),
        secondary: null,
        primary: { label: n >= 2 ? `Share between ${n}` : "Pick 2 or more guests", danger: false, enabled: n >= 2, onClick: () => shareIt(card.key, sheet.picked) },
      };
    }
    const g = sheet.id;
    const rows: { key: string; index: number; label: string; amount: string }[] = [];
    for (const c of cards)
      (units[c.key] ?? []).forEach((u, i) => {
        if (!u || !u.includes(g)) return;
        const order = guests.filter((x) => u.includes(x));
        rows.push({ key: c.key, index: i, label: `${u.length > 1 ? `${share(u.length)} ` : ""}${c.name}`, amount: naira(splitEven(c.unitKobo, order.length)[order.indexOf(g)]) });
      });
    return {
      title: name(g),
      dot: g,
      amount: naira(preview[g] ?? 0),
      hint: rows.length ? "Tap an item to send it back to unassigned. The total includes their share of the service charge and tax." : `Nothing yet — pick ${name(g)} and tap items.`,
      body: (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {rows.map((r) => (
            <button key={`${r.key}-${r.index}`} type="button" onClick={() => giveBack(r.key, r.index, g)} style={{ minHeight: 52, padding: "0 14px", borderRadius: 10, border: `1px solid ${COLORS.border}`, background: "#fff", cursor: "pointer", display: "flex", alignItems: "center", gap: 10, textAlign: "left" }}>
              <span style={{ flex: 1, fontSize: 14, fontWeight: 500, color: COLORS.ink }}>{r.label}</span>
              <span style={{ fontSize: 14, fontWeight: 600, ...NUM }}>{r.amount}</span>
              <span style={{ height: 32, padding: "0 12px", borderRadius: 8, background: COLORS.bgInput, color: COLORS.slate, fontSize: 12.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                <Undo2 size={14} strokeWidth={1.9} />
                Return
              </span>
            </button>
          ))}
        </div>
      ),
      secondary: { label: guests.length > 2 ? `Remove ${name(g)}` : "A split needs 2 guests", icon: true, onClick: () => dropGuest(g) },
      primary: { label: `Done · ${name(g)} picked`, danger: false, enabled: true, onClick: () => { setActive(g); setSheet(null); } },
    };
  })();

  const tabs: [Mode, string, typeof ListChecks][] = [
    ["ITEMS", "By item", ListChecks],
    ["EQUAL", "Equal", Equal],
    ["AMOUNT", "By amount", Calculator],
  ];
  const button48 = { height: 48, borderRadius: 10, border: `1px solid ${COLORS.borderStrong}`, background: "#fff", color: COLORS.slate, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" } as const;

  return (
    // Over the Bill panel: a click outside closes this pop-up only.
    <div
      onClick={(event) => {
        event.stopPropagation();
        onClose();
      }}
      style={{ position: "fixed", inset: 0, background: "rgba(23,27,28,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 90, padding: 16 }}
    >
      <div
        role="dialog"
        aria-label="Split bill"
        onClick={(event) => event.stopPropagation()}
        style={{ width: "min(760px, 100%)", height: "min(900px, 100%)", background: "#fff", borderRadius: 16, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative", fontFamily: FONTS.body }}
      >
        {/* Header: the bill's total always in view */}
        <div style={{ padding: "14px 16px 12px 20px", display: "flex", alignItems: "center", gap: 12, borderBottom: `1px solid ${COLORS.border}` }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <span style={{ fontFamily: FONTS.display, fontSize: 20, fontWeight: 600 }}>{editing ? "Edit split" : "Split bill"}</span>
            <span style={{ fontSize: 12.5, color: COLORS.slateMid }}>
              {bill.order.table} · <span style={{ fontFamily: FONTS.mono }}>{bill.order.ref}</span>
            </span>
          </div>
          <span data-split-total style={{ marginLeft: "auto", fontFamily: FONTS.display, fontSize: 22, fontWeight: 700, ...NUM }}>
            {bill.totals.total}
          </span>
          {mode === "ITEMS" && (
            <button type="button" aria-label="Clear all assignments" title="Clear all assignments" onClick={() => setSheet({ type: "reset" })} style={{ ...button48, width: 48 }}>
              <RotateCcw size={18} strokeWidth={1.8} />
            </button>
          )}
          <button type="button" aria-label="Close" onClick={onClose} style={{ ...button48, width: 48 }}>
            <X size={20} strokeWidth={1.8} />
          </button>
        </div>

        <div style={{ padding: "12px 20px 0" }}>
          <div role="tablist" aria-label="Split mode" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", background: COLORS.bgInput, borderRadius: 12, padding: 4, gap: 4 }}>
            {tabs.map(([key, label, Icon]) => {
              const on = mode === key;
              return (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => pickMode(key)}
                  style={{ height: 44, border: "none", borderRadius: 9, background: on ? "#fff" : "transparent", color: on ? COLORS.ink : COLORS.slate, fontSize: 14, fontWeight: 600, cursor: "pointer", boxShadow: on ? "0 1px 3px rgba(23,27,28,.15)" : "none", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
                >
                  <Icon size={16} strokeWidth={1.8} />
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {(refusal || bill.settleBlocker) && (
          <div role="alert" style={{ margin: "12px 20px 0", padding: "10px 12px", borderRadius: 10, background: "#fff7e8", border: "1px solid #f1dcb0", display: "flex", alignItems: "center", gap: 10, fontSize: 13.5, color: "#5c4510" }}>
            <RefreshCw size={16} strokeWidth={1.8} style={{ flex: "0 0 auto" }} />
            <span style={{ flex: 1 }}>
              {bill.settleBlocker ?? (refusal!.stale ? "This bill changed on another device. Your assignments are kept — reload it, check, then split again." : refusal!.error)}
            </span>
            {refusal?.stale && (
              <button
                type="button"
                onClick={() => {
                  router.refresh();
                  setRefusal(null);
                }}
                style={{ height: 44, padding: "0 14px", borderRadius: 9, border: "none", background: "#8a5a00", color: "#fff", fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}
              >
                Reload bill
              </button>
            )}
            {refusal && !refusal.stale && (
              <button type="button" aria-label="Dismiss" onClick={() => setRefusal(null)} style={{ border: "none", background: "none", color: "#5c4510", cursor: "pointer", display: "flex" }}>
                <X size={16} strokeWidth={1.8} />
              </button>
            )}
          </div>
        )}

        {/* ===== By item ===== */}
        {mode === "ITEMS" && (
          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <div aria-label="Guests" style={{ padding: "12px 20px 0", display: "flex", flexWrap: "wrap", gap: 8 }}>
              {guests.map((g, i) => {
                const on = g === active;
                return (
                  <div key={g} data-guest={i + 1} data-active={on || undefined} style={{ height: 48, display: "flex", borderRadius: 24, border: `2px solid ${on ? colorOf(g) : COLORS.borderStrong}`, background: on ? `${colorOf(g)}14` : "#fff", overflow: "hidden", boxShadow: on ? `0 0 0 3px ${colorOf(g)}22` : "none" }}>
                    <button type="button" aria-label={`Pick Guest ${i + 1}`} aria-pressed={on} onClick={() => setActive(g)} style={{ height: "100%", padding: "0 10px 0 6px", border: "none", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 600, color: COLORS.ink }}>
                      <Dot id={g} n={i + 1} />
                      Guest {i + 1}
                    </button>
                    <button type="button" aria-label={`Guest ${i + 1}'s items`} onClick={() => setSheet({ type: "guest", id: g })} style={{ height: "100%", padding: "0 12px", border: "none", borderLeft: `1px solid ${on ? `${colorOf(g)}55` : COLORS.border}`, background: "transparent", cursor: "pointer", color: COLORS.ink, fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", gap: 6, ...NUM }}>
                      {nairaWhole(preview[g] ?? 0)}
                      <ChevronDown size={14} strokeWidth={1.8} style={{ opacity: 0.7 }} />
                    </button>
                  </div>
                );
              })}
              <button type="button" onClick={addGuest} disabled={guests.length >= MAX_GUESTS} style={{ height: 48, padding: "0 16px", borderRadius: 24, border: `2px dashed ${COLORS.borderStrong}`, background: "#fff", color: COLORS.slate, fontSize: 14, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
                <Plus size={16} strokeWidth={2} />
                Guest
              </button>
            </div>

            <div style={{ padding: "12px 20px 4px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 220, display: "flex", flexDirection: "column", gap: 6 }}>
                <span data-split-progress style={{ fontSize: 14, color: COLORS.slate, fontWeight: 500, ...NUM }}>
                  {complete ? `Everything is assigned · ${guests.length} guests` : `${naira(itemsKobo ? Math.round((left.kobo * totalKobo) / itemsKobo) : 0)} left to assign · ${left.count} item${left.count === 1 ? "" : "s"}`}
                </span>
                <div style={{ height: 6, borderRadius: 3, background: COLORS.border, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${itemsKobo ? Math.round(((itemsKobo - left.kobo) / itemsKobo) * 100) : 0}%`, background: COLORS.teal, borderRadius: 3, transition: "width .12s" }} />
                </div>
              </div>
              {!complete && (
                <button type="button" onClick={giveRest} style={{ height: 48, padding: "0 16px", borderRadius: 10, border: `1.5px solid ${COLORS.teal}`, background: "#fff", color: COLORS.tealDark, fontSize: 14, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}>
                  <ChevronsRight size={16} strokeWidth={2} />
                  Rest to {name(active)}
                </button>
              )}
            </div>

            <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "10px 20px 16px" }}>
              <div aria-label="Items" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gridAutoRows: "max-content", gap: 10 }}>
                {[...cards]
                  .sort((a, b) => Number(!(units[a.key] ?? []).includes(null)) - Number(!(units[b.key] ?? []).includes(null)))
                  .map((c) => {
                    const slots = units[c.key] ?? [];
                    const free = slots.filter((u) => !u).length;
                    const full = free === 0;
                    const dots: { id: number; label: string }[] = [];
                    guests.forEach((g, gi) => {
                      const mine = slots.filter((u) => u && u.length === 1 && u[0] === g).length;
                      for (let k = 0; k < Math.min(mine, 4); k++) dots.push({ id: g, label: String(gi + 1) });
                      if (mine > 4) dots.push({ id: g, label: `+${mine - 4}` });
                    });
                    const shared = slots.filter((u): u is number[] => !!u && u.length > 1);
                    return (
                      <div key={c.key} style={{ position: "relative" }}>
                        <button
                          type="button"
                          data-split-card={c.name}
                          data-left={free}
                          disabled={full}
                          onClick={() => tapCard(c.key)}
                          onPointerDown={pressStart(c.key)}
                          onPointerUp={pressEnd}
                          onPointerLeave={pressEnd}
                          onContextMenu={(event) => event.preventDefault()}
                          style={{ width: "100%", minHeight: 76, textAlign: "left", border: `1.5px solid ${full ? COLORS.border : "#cfe3de"}`, borderRadius: 12, padding: "10px 52px 10px 12px", background: full ? "#fafbfb" : "#fff", cursor: full ? "default" : "pointer", display: "flex", flexDirection: "column", gap: 5, opacity: full ? 0.75 : 1, userSelect: "none", WebkitTouchCallout: "none" } as CSSProperties}
                        >
                          <span style={{ fontSize: 14.5, fontWeight: 600, color: COLORS.ink, lineHeight: 1.3 }}>
                            {c.qty > 1 ? `${c.qty}× ` : ""}
                            {c.name}
                          </span>
                          <span style={{ fontSize: 13.5, fontWeight: 600, color: COLORS.tealDark, ...NUM }}>
                            {naira(c.unitKobo)}
                            {c.qty > 1 ? " ea" : ""}
                          </span>
                          {c.detail && <span style={{ fontSize: 12, color: COLORS.slateMid }}>{c.detail}</span>}
                          <span style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", minHeight: 24 }}>
                            <span style={{ height: 24, padding: "0 9px", borderRadius: 12, background: full ? COLORS.bgInput : "#e3f4ee", color: full ? COLORS.slateMid : COLORS.tealDark, fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", ...NUM }}>{full ? "All assigned" : `${free} left`}</span>
                            {dots.map((d, i) => (
                              <Dot key={i} id={d.id} n={d.label} size={24} />
                            ))}
                            {shared.map((u, i) => (
                              <span key={`s${i}`} style={{ height: 24, padding: "0 8px", borderRadius: 12, background: COLORS.slate, color: "#fff", fontSize: 11.5, fontWeight: 700, display: "flex", alignItems: "center", ...NUM }}>
                                {share(u.length)} {u.map((g) => guests.indexOf(g) + 1).join("+")}
                              </span>
                            ))}
                          </span>
                        </button>
                        {!full && (
                          <button type="button" aria-label={`Share ${c.name} between guests`} title="Share between guests (or long-press the card)" onClick={() => setSheet({ type: "share", key: c.key, picked: [] })} style={{ position: "absolute", top: 8, right: 8, width: 40, height: 40, borderRadius: 10, border: `1px solid ${COLORS.borderStrong}`, background: "#fff", color: COLORS.slate, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                            <Split size={16} strokeWidth={1.8} />
                          </button>
                        )}
                      </div>
                    );
                  })}
              </div>
            </div>
          </div>
        )}

        {/* ===== Equal ===== */}
        {mode === "EQUAL" && (
          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", alignItems: "center", padding: "18px 20px 8px", gap: 14 }}>
            <span style={{ fontSize: 13.5, color: COLORS.slate }}>How many guests?</span>
            <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
              <button type="button" aria-label="Fewer guests" disabled={ways <= 2} onClick={() => setWays(clamp(ways - 1, 2, MAX_GUESTS))} style={{ width: 72, height: 72, borderRadius: 36, border: `1.5px solid ${COLORS.borderStrong}`, background: "#fff", color: COLORS.ink, cursor: ways <= 2 ? "default" : "pointer", opacity: ways <= 2 ? 0.4 : 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Minus size={26} strokeWidth={2} />
              </button>
              <span data-ways style={{ width: 110, textAlign: "center", fontFamily: FONTS.display, fontSize: 60, fontWeight: 700, lineHeight: 1, ...NUM }}>
                {ways}
              </span>
              <button type="button" aria-label="More guests" disabled={ways >= MAX_GUESTS} onClick={() => setWays(clamp(ways + 1, 2, MAX_GUESTS))} style={{ width: 72, height: 72, borderRadius: 36, border: "none", background: COLORS.teal, color: "#fff", cursor: ways >= MAX_GUESTS ? "default" : "pointer", opacity: ways >= MAX_GUESTS ? 0.4 : 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Plus size={26} strokeWidth={2} />
              </button>
            </div>
            <span style={{ fontSize: 12.5, color: COLORS.slateMid }}>2 to {MAX_GUESTS} · any kobo of rounding goes on the last guest</span>
            <div aria-label="Parts" style={{ width: "100%", maxWidth: 520, flex: 1, minHeight: 0, overflowY: "auto", border: `1px solid ${COLORS.border}`, borderRadius: 12 }}>
              {equal.ok &&
                equal.amounts.map((a, i) => (
                  <div key={i} data-part={i + 1} style={{ height: 48, padding: "0 14px", display: "flex", alignItems: "center", gap: 10, borderBottom: `1px solid ${COLORS.border}` }}>
                    <Dot id={i + 1} n={i + 1} size={26} />
                    <span style={{ fontSize: 14, fontWeight: 500 }}>Guest {i + 1}</span>
                    <span style={{ marginLeft: "auto", fontSize: 15, fontWeight: 600, ...NUM }}>{formatNaira(a.toFixed(2))}</span>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* ===== By amount ===== */}
        {mode === "AMOUNT" && (
          <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "14px 20px 8px", display: "flex", flexWrap: "wrap", gap: 16, alignContent: "flex-start" }}>
            <div style={{ flex: "1 1 300px", display: "flex", flexDirection: "column", gap: 8 }}>
              {Array.from({ length: amtCount }, (_, i) => {
                const last = i === amtCount - 1;
                const on = !last && i === amtActive;
                const v = typed[i] ?? "";
                return (
                  <button
                    key={i}
                    type="button"
                    data-amount-row={i + 1}
                    onClick={() => !last && setAmtActive(i)}
                    style={{ minHeight: 56, padding: "0 14px", borderRadius: 12, border: `2px solid ${on ? COLORS.teal : last ? "#cfe3de" : COLORS.border}`, background: last ? "#f3faf8" : "#fff", cursor: last ? "default" : "pointer", display: "flex", alignItems: "center", gap: 10, textAlign: "left" }}
                  >
                    <Dot id={i + 1} n={i + 1} size={28} />
                    <span style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: COLORS.ink }}>Guest {i + 1}</span>
                      <span style={{ fontSize: 11.5, color: COLORS.slateMid }}>{last ? "Pays the rest" : on ? "Typing…" : "Tap to enter"}</span>
                    </span>
                    <span style={{ marginLeft: "auto", fontFamily: FONTS.display, fontSize: 19, fontWeight: 600, color: last ? COLORS.tealDark : v ? COLORS.ink : COLORS.slateLight, ...NUM }}>
                      {last ? naira(Math.max(0, lastKobo)) : v ? naira(kobo(v)) : "—"}
                    </span>
                  </button>
                );
              })}
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", paddingTop: 2 }}>
                <button type="button" disabled={amtCount >= MAX_GUESTS} onClick={() => setAmtCount(clamp(amtCount + 1, 2, MAX_GUESTS))} style={{ height: 44, padding: "0 4px", border: "none", background: "none", color: COLORS.tealDark, fontSize: 13.5, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
                  <Plus size={15} strokeWidth={2} />
                  Add a guest
                </button>
                {amtCount > 2 && (
                  <button
                    type="button"
                    onClick={() => {
                      setAmtCount(amtCount - 1);
                      setAmtActive(Math.min(amtActive, amtCount - 3));
                    }}
                    style={{ height: 44, padding: "0 4px", border: "none", background: "none", color: COLORS.slate, fontSize: 13.5, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}
                  >
                    <Minus size={15} strokeWidth={2} />
                    Remove the last guest
                  </button>
                )}
                {typed.some((v) => !(Number(v || 0) > 0)) && lastKobo > 0 && (
                  <button type="button" onClick={remainderEqually} style={{ height: 44, padding: "0 4px", border: "none", background: "none", color: COLORS.tealDark, fontSize: 13.5, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, marginLeft: "auto" }}>
                    <Equal size={15} strokeWidth={2} />
                    Split remainder equally
                  </button>
                )}
              </div>
            </div>
            <div aria-label="Keypad" style={{ flex: "0 1 264px", margin: "0 auto", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, alignSelf: "flex-start" }}>
              {["1", "2", "3", "4", "5", "6", "7", "8", "9", "00", "0", "back"].map((k) => (
                <button key={k} type="button" aria-label={k === "back" ? "Delete a digit" : k} onClick={() => press(k)} style={{ height: 60, borderRadius: 12, border: `1px solid ${COLORS.borderStrong}`, background: k === "back" ? COLORS.bgInput : "#fff", color: COLORS.ink, fontSize: 20, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", ...NUM }}>
                  {k === "back" ? <Delete size={20} strokeWidth={1.8} /> : k}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Footer: the button says what's next */}
        <div style={{ padding: "14px 20px", borderTop: `1px solid ${COLORS.border}`, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <span style={{ flex: "1 1 200px", fontSize: 13, color: COLORS.slateMid, lineHeight: 1.45, ...NUM }}>{note}</span>
          <button
            type="button"
            data-split-submit
            onClick={() => void submit()}
            disabled={!ready}
            style={{ flex: "1 1 280px", height: 56, padding: "0 22px", border: "none", borderRadius: 12, background: ready ? COLORS.teal : "#e4e8e9", color: ready ? "#fff" : COLORS.slateMid, fontSize: 15.5, fontWeight: 600, cursor: ready ? "pointer" : "default", ...NUM }}
          >
            {saving ? "Splitting…" : label}
          </button>
        </div>

        {toast && (
          <div role="status" style={{ position: "absolute", left: "50%", bottom: 96, transform: "translateX(-50%)", background: COLORS.ink, color: "#fff", borderRadius: 24, height: 48, padding: "0 6px 0 18px", display: "flex", alignItems: "center", gap: 12, fontSize: 14, boxShadow: "0 10px 24px -10px rgba(0,0,0,.5)", whiteSpace: "nowrap", maxWidth: "calc(100% - 32px)" }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{toast.text}</span>
            <button type="button" onClick={undo} style={{ height: 36, padding: "0 14px", borderRadius: 18, border: "none", background: "#2c3436", color: "#7fd8c6", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
              Undo
            </button>
          </div>
        )}

        {sheetBody && (
          <div onClick={() => setSheet(null)} style={{ position: "absolute", inset: 0, background: "rgba(23,27,28,.35)", display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
            <div role="dialog" aria-label={sheetBody.title} onClick={(event) => event.stopPropagation()} style={{ width: "100%", maxWidth: 560, background: "#fff", borderRadius: "16px 16px 0 0", padding: "18px 20px 20px", display: "flex", flexDirection: "column", gap: 12, maxHeight: "80%", overflowY: "auto" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {"dot" in sheetBody && typeof sheetBody.dot === "number" && <Dot id={sheetBody.dot} n={guests.indexOf(sheetBody.dot) + 1} />}
                <span style={{ fontFamily: FONTS.display, fontSize: 18, fontWeight: 600 }}>{sheetBody.title}</span>
                <span style={{ marginLeft: "auto", fontSize: 16, fontWeight: 600, ...NUM }}>{sheetBody.amount}</span>
              </div>
              <span style={{ fontSize: 13, color: COLORS.slateMid }}>{sheetBody.hint}</span>
              {sheetBody.body}
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap", marginTop: 4 }}>
                {sheetBody.secondary && (
                  <button type="button" onClick={sheetBody.secondary.onClick} style={{ height: 48, padding: "0 16px", borderRadius: 10, border: `1px solid ${COLORS.borderStrong}`, background: "#fff", color: COLORS.slate, fontSize: 14, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}>
                    {"icon" in sheetBody.secondary && <UserMinus size={16} strokeWidth={1.8} />}
                    {sheetBody.secondary.label}
                  </button>
                )}
                <button
                  type="button"
                  disabled={!sheetBody.primary.enabled}
                  onClick={sheetBody.primary.onClick}
                  style={{ height: 48, padding: "0 20px", borderRadius: 10, border: "none", background: !sheetBody.primary.enabled ? COLORS.borderStrong : sheetBody.primary.danger ? COLORS.danger : COLORS.teal, color: "#fff", fontSize: 14, fontWeight: 600, cursor: sheetBody.primary.enabled ? "pointer" : "default" }}
                >
                  {sheetBody.primary.label}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
