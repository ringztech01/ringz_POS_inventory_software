"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { KitchenStatus } from "@prisma/client";
import { Volume2, VolumeX, X } from "lucide-react";
import { FONTS } from "@/components/layout/theme";
import { fmtElapsed, isLate, nextStep, previousStep, type KdsView, type KitchenStep } from "../../lib/kds";
import { KDS } from "../../lib/theme";
import { advanceKitchenLine, bumpKitchenTicket, recallKitchenLine, recallKitchenTicket } from "../../server/actions/kitchen";
import type { KitchenResult } from "../../server/services/kitchen";
import type { KdsLine, KdsTicket, KitchenBoardData } from "../../server/queries/kds";
import FloorPolling from "../floor/FloorPolling";
import TicketCard from "./TicketCard";

// /restaurant/kitchen — the kitchen display (RingzPOS Kitchen Display
// design). Live without websockets, so it works on a local network with no
// internet: the page re-renders from the server every 5s while the tab is
// visible (FloorPolling), a 1s clock keeps the timers running (offset to
// the server's time), and a short chime plays when a new ticket arrives.

// ---- Sound on/off, remembered on this screen ----------------------------------

const SOUND_KEY = "ringzpos.kds.sound";
const soundListeners = new Set<() => void>();
function readSound(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) === "on";
  } catch {
    return false;
  }
}
function writeSound(on: boolean) {
  try {
    localStorage.setItem(SOUND_KEY, on ? "on" : "off");
  } catch {
    // Storage blocked: the toggle still works until the page reloads.
  }
  soundListeners.forEach((listener) => listener());
}
function subscribeSound(listener: () => void) {
  soundListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    soundListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

// Two soft notes (WebAudio — no sound file, nothing to download).
function chime(ctx: AudioContext) {
  const start = ctx.currentTime;
  [880, 1318.5].forEach((frequency, i) => {
    const at = start + i * 0.18;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.3, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.4);
    osc.connect(gain).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + 0.45);
  });
}

// ---- The board ----------------------------------------------------------------

// A tap shown ahead of the server: shown while the server still has `base`.
type Pending<V> = { value: V; base: V };

const hrefFor = (station: string | null, view: KdsView) => {
  const params = new URLSearchParams();
  if (station) params.set("station", station);
  if (view === "done") params.set("view", "done");
  const query = params.toString();
  return `/restaurant/kitchen${query ? `?${query}` : ""}`;
};

export default function KitchenBoard({ data, canManage }: { data: KitchenBoardData; canManage: boolean }) {
  const router = useRouter();
  const [lineTaps, setLineTaps] = useState<Map<string, Pending<KitchenStatus>>>(new Map());
  const [ticketTaps, setTicketTaps] = useState<Map<string, string | null>>(new Map());
  const [saving, setSaving] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // The clock: the server's time, ticking every second.
  const [now, setNow] = useState(() => Date.parse(data.serverNow));
  const offset = useRef(0);
  useEffect(() => {
    offset.current = Date.parse(data.serverNow) - Date.now();
  }, [data.serverNow]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now() + offset.current), 1000);
    return () => clearInterval(timer);
  }, []);

  // Sound: off until someone switches it on here (browsers only play audio
  // after a tap), then a chime for every new ticket.
  const sound = useSyncExternalStore(subscribeSound, readSound, () => false);
  const audio = useRef<AudioContext | null>(null);
  function toggleSound() {
    const on = !sound;
    if (on) {
      audio.current ??= new AudioContext();
      void audio.current.resume().then(() => chime(audio.current!));
    }
    writeSound(on);
  }
  const seen = useRef<{ station: string | null; ids: Set<string> } | null>(null);
  useEffect(() => {
    const ids = data.active.map((t) => t.id);
    const before = seen.current;
    if (before && before.station === data.station && ids.some((id) => !before.ids.has(id)) && sound) {
      audio.current ??= new AudioContext();
      if (audio.current.state === "running") chime(audio.current);
    }
    seen.current = { station: data.station, ids: new Set([...(before?.station === data.station ? before.ids : []), ...ids]) };
  }, [data.active, data.station, sound]);

  const statusOf = (line: KdsLine): KitchenStatus => {
    const tap = lineTaps.get(line.itemId);
    return tap && tap.base === line.status ? tap.value : line.status;
  };
  const ticketBusy = (ticket: KdsTicket) => ticketTaps.has(ticket.id) && ticketTaps.get(ticket.id) === ticket.bumpedAt;

  async function save(change: () => Promise<KitchenResult>, undo: () => void) {
    setSaving((n) => n + 1);
    try {
      const result = await change();
      if (result.ok) setError(null);
      else {
        setError(result.error);
        undo();
      }
    } catch {
      setError("Couldn't reach the server — check the connection and try again.");
      undo();
    } finally {
      setSaving((n) => n - 1);
      router.refresh();
    }
  }
  const forgetLines = (ids: string[]) =>
    setLineTaps((taps) => {
      const next = new Map(taps);
      ids.forEach((id) => next.delete(id));
      return next;
    });
  const forgetTicket = (id: string) =>
    setTicketTaps((taps) => {
      const next = new Map(taps);
      next.delete(id);
      return next;
    });

  function stepLine(line: KdsLine, from: KitchenStep, direction: "forward" | "back") {
    const to = direction === "forward" ? nextStep(from) : previousStep(from);
    if (!to) return;
    setLineTaps((taps) => new Map(taps).set(line.itemId, { value: to, base: line.status }));
    void save(
      () => (direction === "forward" ? advanceKitchenLine({ itemId: line.itemId, from }) : recallKitchenLine({ itemId: line.itemId, from })),
      () => forgetLines([line.itemId]),
    );
  }

  function bump(ticket: KdsTicket) {
    const moving = ticket.lines.filter((line) => {
      const status = statusOf(line);
      return status === "PENDING" || status === "PREPARING";
    });
    setLineTaps((taps) => {
      const next = new Map(taps);
      moving.forEach((line) => next.set(line.itemId, { value: "READY", base: line.status }));
      return next;
    });
    setTicketTaps((taps) => new Map(taps).set(ticket.id, ticket.bumpedAt));
    void save(
      () => bumpKitchenTicket({ kotId: ticket.id }),
      () => {
        forgetLines(moving.map((line) => line.itemId));
        forgetTicket(ticket.id);
      },
    );
  }

  function recall(ticket: KdsTicket) {
    setTicketTaps((taps) => new Map(taps).set(ticket.id, ticket.bumpedAt));
    void save(() => recallKitchenTicket({ kotId: ticket.id }), () => forgetTicket(ticket.id));
  }

  const late = data.active.filter((t) => isLate(t.sentAt, t.lateAfterMin, now)).length;
  const averageAge = data.active.length
    ? fmtElapsed(now - data.active.reduce((sum, t) => sum + (now - Date.parse(t.sentAt)), 0) / data.active.length, now)
    : "00:00";

  const tab = (on: boolean) =>
    ({
      height: 32,
      padding: "0 14px",
      border: "none",
      borderRadius: 6,
      background: on ? KDS.teal : "transparent",
      color: on ? "#fff" : KDS.soft,
      fontSize: 13,
      fontWeight: 600,
      display: "flex",
      alignItems: "center",
      textDecoration: "none",
    }) as const;
  const group = { display: "flex", gap: 4, background: KDS.card, borderRadius: 9, padding: 3 } as const;

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: KDS.bg, color: KDS.text }}>
      <FloorPolling />
      <header style={{ height: 60, background: KDS.header, borderBottom: `1px solid ${KDS.divider}`, display: "flex", alignItems: "center", gap: 20, padding: "0 24px", flexShrink: 0 }}>
        <div style={{ width: 32, height: 32, borderRadius: 9, background: KDS.teal, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONTS.display, fontWeight: 700 }}>
          R
        </div>
        <h1 style={{ margin: 0, fontFamily: FONTS.display, fontSize: 18, fontWeight: 600 }}>Kitchen display</h1>
        <nav aria-label="Stations" style={group}>
          {[{ code: null, name: "All" }, ...data.stations].map((s) => (
            <Link key={s.code ?? "all"} href={hrefFor(s.code, data.view)} replace scroll={false} aria-current={data.station === s.code ? "page" : undefined} style={tab(data.station === s.code)}>
              {s.name}
            </Link>
          ))}
        </nav>
        <nav aria-label="View" style={group}>
          {(["active", "done"] as const).map((v) => (
            <Link key={v} href={hrefFor(data.station, v)} replace scroll={false} aria-current={data.view === v ? "page" : undefined} style={tab(data.view === v)}>
              {v === "active" ? "Active" : "Recently done"}
            </Link>
          ))}
        </nav>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 20, fontFamily: FONTS.mono, fontSize: 13, color: KDS.muted }}>
          <span aria-live="polite" style={{ minWidth: 60, color: KDS.qty, fontFamily: FONTS.body, fontWeight: 600 }}>
            {saving > 0 ? "Saving…" : ""}
          </span>
          <span data-count="tickets">{data.active.length} tickets</span>
          <span data-count="late" style={{ color: KDS.lateText }}>
            {late} late
          </span>
          <span data-count="age">Avg {averageAge}</span>
          <button
            type="button"
            onClick={toggleSound}
            aria-pressed={sound}
            aria-label={sound ? "Sound on — turn off" : "Sound off — turn on"}
            title={sound ? "Chime on new tickets: on" : "Chime on new tickets: off"}
            style={{ height: 32, width: 36, border: `1px solid ${KDS.buttonBorder}`, borderRadius: 8, background: "transparent", color: sound ? KDS.qty : KDS.muted, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
          >
            {sound ? <Volume2 size={16} strokeWidth={2} /> : <VolumeX size={16} strokeWidth={2} />}
          </button>
          <Link href="/restaurant/floor" style={{ fontFamily: FONTS.body, fontWeight: 600, color: KDS.link }}>
            Floor →
          </Link>
        </div>
      </header>

      {error && (
        <div role="alert" style={{ margin: "16px 20px 0", padding: "10px 14px", borderRadius: 9, background: KDS.lateHead, border: `1px solid ${KDS.lateBorder}`, display: "flex", alignItems: "center", gap: 10, fontSize: 13.5 }}>
          <span style={{ flex: 1 }}>{error}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setError(null)} style={{ border: "none", background: "none", color: KDS.text, cursor: "pointer", display: "flex" }}>
            <X size={16} strokeWidth={2} />
          </button>
        </div>
      )}

      <main style={{ flex: 1, padding: 20 }}>
        {data.tickets.length === 0 ? (
          <p data-empty style={{ margin: "80px auto", maxWidth: 420, textAlign: "center", fontSize: 15, color: KDS.muted }}>
            {data.view === "active" ? "No tickets waiting. New orders appear here as soon as they're sent." : "Nothing finished in the last 6 hours."}
          </p>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14, alignContent: "start" }}>
            {data.tickets.map((ticket) => (
              <TicketCard
                key={ticket.id}
                ticket={ticket}
                view={data.view}
                now={now}
                canManage={canManage}
                busy={ticketBusy(ticket)}
                statusOf={statusOf}
                onAdvance={(line, from) => stepLine(line, from, "forward")}
                onRecallLine={(line, from) => stepLine(line, from, "back")}
                onBump={() => bump(ticket)}
                onRecall={() => recall(ticket)}
              />
            ))}
          </div>
        )}
      </main>

      <footer style={{ padding: "0 24px 18px", fontSize: 12.5, color: KDS.faint }}>
        {canManage
          ? "Tap a line to move it Pending → Preparing → Ready; tap its status to step back. Waiters mark Served from the order screen."
          : "View only — changing lines needs the Manage Kitchen permission."}
      </footer>
    </div>
  );
}
