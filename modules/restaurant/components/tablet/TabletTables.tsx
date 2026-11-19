"use client";

import { memo, useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { TAB_NAME_MAX } from "../../schemas/pos";
import { dimmed, lookLabel, type TabletLook, type TabletTile } from "../../lib/tabletTables";
import { tabletOrder, TABLET_LOGIN, TABLET_NEW_ORDER, TABLET_TABLES } from "../../lib/tabletDevice";
import { markTableClean, openTable } from "../../server/actions/floor";
import { seatReservation } from "../../server/actions/reservations";
import { lockPos } from "../../server/actions/session";
import { printBillAction } from "../../server/actions/printing";
import TabletFloor, { LOOK_STYLE, type TabletFloorProps } from "./TabletFloor";
import TabletSheet, { SheetButton, TabletKeyboard, TabletToast, useTabletToast } from "./TabletSheet";
import TabletAutoLock from "./TabletAutoLock";
import { T } from "./tabletTheme";
import { TabletPolling, useTabletConnection } from "./useTabletConnection";
import { QUEUE_PREFIX, readStoredQueue, waitingText } from "../../lib/tabletQueue";

// The tablet's Tables, upright (Part 6g Step 3; design: RingzPOS
// Tablet.dc.html › Tablet Tables): the header with the user chip and LOCK,
// an area's tab with how many of its tables are free, MY TABLES and the
// legend, the tables as 164 px tiles three across, and TAKEAWAY / BAR TAB.
// A free table asks "How many guests?" then opens its order; a booked one
// seats the booking; an open one goes to its order (or, shared, asks which
// check). The floor comes from the server every 5 s (FloorPolling): tiles
// change in place, the scroll stays where it is. In landscape (Step 4) the
// same screen shows the floor (TabletFloor) — both are here and the
// tablet's turn picks one (CSS), so rotating never reloads and keeps the
// area, the selection and MY TABLES.

const UNREACHABLE = "Couldn't reach the server. Check the connection and try again.";

const LEGEND: TabletLook[] = ["FREE", "SEATED", "SENT", "BILL", "LATE"];

export type TabletTablesProps = {
  user: { id: string; firstName: string; initials: string; manager: boolean };
  areas: { id: string; name: string; free: string }[];
  areaId: string | null;
  tiles: TabletTile[];
  can: { book: boolean; settle: boolean };
  session: { clockOn: boolean; onShift: boolean };
  // Idle seconds before this tablet locks (0: never).
  autoLockSeconds: number;
  // The landscape floor (Step 4).
  areaName: string;
  room: TabletFloorProps["room"];
  fixtures: TabletFloorProps["fixtures"];
  places: TabletFloorProps["places"];
  summary: TabletFloorProps["summary"];
};

type Sheet =
  | { kind: "guests"; tile: TabletTile }
  | { kind: "booking"; tile: TabletTile }
  | { kind: "checks"; tile: TabletTile }
  | { kind: "cleaning"; tile: TabletTile }
  | { kind: "barTab" }
  | { kind: "endShift" }
  | { kind: "handover"; to: { id: string; name: string; onShift: boolean }[]; orders: number };

const Tile = memo(function Tile({ tile, dim, onTap }: { tile: TabletTile; dim: boolean; onTap: (tile: TabletTile) => void }) {
  const look = LOOK_STYLE[tile.look];
  return (
    <button
      type="button"
      className="tb-press"
      data-table-tile={tile.name}
      data-look={tile.look}
      data-dim={dim ? "" : undefined}
      onClick={() => onTap(tile)}
      style={{ border: "none", borderRadius: 10, background: look.bg, color: T.text, boxShadow: look.ring, opacity: dim ? 0.25 : 1, cursor: "pointer", padding: "16px 18px", display: "flex", flexDirection: "column", justifyContent: "space-between", alignItems: "stretch", textAlign: "left", fontFamily: "inherit", minWidth: 0 }}
    >
      <span style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <span style={{ fontSize: 52, fontWeight: 900, lineHeight: 0.95, letterSpacing: "-.02em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{tile.name}</span>
        <span style={{ fontSize: 16, fontWeight: 800, opacity: 0.9 }}>{tile.initials ?? ""}</span>
      </span>
      <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <span style={{ fontSize: 18, fontWeight: 800 }}>{lookLabel(tile)}</span>
        <span style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 17, fontWeight: 700, opacity: 0.92 }}>
          <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{tile.info}</span>
          <span style={{ whiteSpace: "nowrap" }}>{tile.total ?? ""}</span>
        </span>
      </span>
    </button>
  );
});

// Dishes still on this tablet for an order it left (the app was closed with
// no connection): a way back to them, so they're never forgotten.
function WaitingOrders({ onOpen }: { onOpen: (orderId: string) => void }) {
  const [waiting, setWaiting] = useState<{ orderId: string; text: string }[]>([]);
  useEffect(() => {
    const look = () => {
      try {
        setWaiting(
          Object.keys(localStorage)
            .filter((key) => key.startsWith(QUEUE_PREFIX))
            .flatMap((key) => {
              const saved = readStoredQueue(JSON.parse(localStorage.getItem(key) ?? "null"));
              return saved.entries.length ? [{ orderId: key.slice(QUEUE_PREFIX.length), text: waitingText(saved.entries.length, saved.title || "an order") }] : [];
            }),
        );
      } catch {
        setWaiting([]);
      }
    };
    const first = window.setTimeout(look, 0);
    const timer = window.setInterval(look, 5000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, []);
  if (waiting.length === 0) return null;
  return (
    <div style={{ position: "absolute", left: 16, right: 16, bottom: 120, zIndex: 20, display: "flex", flexDirection: "column", gap: 8 }}>
      {waiting.map((w) => (
        <button key={w.orderId} type="button" className="tb-press" data-waiting-order={w.orderId} onClick={() => onOpen(w.orderId)} style={{ height: 64, border: "none", borderRadius: 8, background: "#FFE08A", color: "#000", fontSize: 20, fontWeight: 900, fontFamily: "inherit", cursor: "pointer" }}>
          {w.text} · OPEN ›
        </button>
      ))}
    </div>
  );
}

export default function TabletTables({ user, areas, areaId, tiles, can, session, autoLockSeconds, areaName, room, fixtures, places, summary }: TabletTablesProps) {
  const router = useRouter();
  const [mineOnly, setMineOnly] = useState(false);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [tabName, setTabName] = useState("");
  const [working, startWork] = useTransition();
  const [toast, say] = useTabletToast();
  const close = useCallback(() => setSheet(null), []);
  const { online } = useTabletConnection();
  // Going to another screen needs the server: with none, the screen stays.
  const whenOnline = (go: () => void) => (online ? go() : say("Offline · retrying"));

  const goOrder = useCallback((orderId: string) => router.push(tabletOrder(orderId)), [router]);

  const onTap = useCallback(
    (tile: TabletTile) => {
      if (!online) return say("Offline · retrying");
      if (tile.checks.length === 1) return goOrder(tile.checks[0].id);
      if (tile.checks.length > 1) return setSheet({ kind: "checks", tile });
      if (tile.look === "RESERVED" && tile.reservation) return setSheet({ kind: "booking", tile });
      if (tile.look === "CLEANING") return setSheet({ kind: "cleaning", tile });
      setSheet({ kind: "guests", tile });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- say only sets the toast
    [goOrder, online],
  );

  function seat(tile: TabletTile, guests: number) {
    startWork(async () => {
      const result = await openTable(tile.id, guests).catch(() => ({ ok: false as const, error: UNREACHABLE }));
      if (result.ok) return goOrder(result.orderId);
      setSheet(null);
      say(result.error);
      if ("orderId" in result && result.orderId) goOrder(result.orderId);
      else router.refresh();
    });
  }
  function seatBooking(tile: TabletTile) {
    const booking = tile.reservation;
    if (!booking) return;
    startWork(async () => {
      const result = await seatReservation(booking.id).catch(() => ({ ok: false as const, error: UNREACHABLE }));
      if (result.ok) return goOrder(result.orderId);
      setSheet(null);
      say(result.error);
      router.refresh();
    });
  }
  function clean(tile: TabletTile) {
    startWork(async () => {
      const result = await markTableClean(tile.id).catch(() => ({ ok: false as const, error: UNREACHABLE }));
      setSheet(null);
      say(result.ok ? `${tile.name} is clean and free.` : result.error);
      router.refresh();
    });
  }
  function lock(endShift: boolean, transferTo: string | null = null) {
    startWork(async () => {
      const result = await lockPos({ endShift, transferTo }).catch(() => ({ ok: false as const, error: UNREACHABLE, signedOut: false, needsHandover: undefined }));
      if (!result.ok && "needsHandover" in result && result.needsHandover) return setSheet({ kind: "handover", to: result.needsHandover.to, orders: result.needsHandover.orders.length });
      if (!result.ok) {
        setSheet(null);
        return say(result.error);
      }
      // A PIN terminal ended the session itself; elsewhere sign out here.
      if (result.signedOut) return window.location.replace(TABLET_LOGIN);
      await signOut({ redirect: false }).catch(() => undefined);
      window.location.replace(TABLET_LOGIN);
    });
  }
  const onLock = () => whenOnline(() => (session.clockOn && session.onShift ? setSheet({ kind: "endShift" }) : lock(false)));
  function printBill(orderId: string) {
    startWork(async () => {
      const result = await printBillAction(orderId).catch(() => ({ ok: false as const, error: UNREACHABLE }));
      if (!result.ok) return say(result.error);
      // No bill printer: the bill's own page, to print from the tablet.
      if (!result.printer) return void window.open(`/restaurant/bill/${encodeURIComponent(orderId)}`, "_blank");
      say(`Bill sent to ${result.printer} · NOT A RECEIPT`);
      router.refresh();
    });
  }
  const openBarTab = () => {
    setTabName("");
    setSheet({ kind: "barTab" });
  };
  const isDim = useCallback((tile: TabletTile) => dimmed(tile, mineOnly, user.manager), [mineOnly, user.manager]);
  const grid = (columns: number) => (
    <div data-table-grid style={{ flex: 1, minHeight: 0, overflowY: "auto", WebkitOverflowScrolling: "touch", padding: "0 16px 16px", display: "grid", gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gridAutoRows: 164, gap: 10, alignContent: "start" }}>
      {tiles.map((tile) => (
        <Tile key={tile.id} tile={tile} dim={isDim(tile)} onTap={onTap} />
      ))}
      {tiles.length === 0 && <span style={{ gridColumn: "1 / -1", padding: 40, textAlign: "center", fontSize: 20, fontWeight: 700, color: T.quiet }}>No tables in this area yet.</span>}
    </div>
  );

  const areaCols = Math.min(Math.max(areas.length, 1), 4);
  return (
    <>
      <TabletPolling intervalMs={5000} />
      <TabletAutoLock seconds={autoLockSeconds} hold={sheet?.kind === "handover" || working} />
      <WaitingOrders onOpen={(id) => whenOnline(() => goOrder(id))} />
      <style>{`.tb-landscape { display: none; } @media (orientation: landscape) { .tb-portrait { display: none !important; } .tb-landscape { display: block; } }`}</style>
      <div className="tb-landscape" style={{ position: "absolute", inset: 0 }}>
        <TabletFloor
          user={user}
          areas={areas}
          areaId={areaId}
          areaName={areaName}
          tiles={tiles}
          room={room}
          fixtures={fixtures}
          places={places}
          summary={summary}
          can={can}
          mineOnly={mineOnly}
          isDim={isDim}
          working={working}
          onArea={(id) => whenOnline(() => router.replace(`${TABLET_TABLES}?area=${encodeURIComponent(id)}`))}
          onToggleMine={() => setMineOnly(!mineOnly)}
          onSeat={seat}
          onSeatBooking={seatBooking}
          onClean={clean}
          onOpenOrder={(id) => whenOnline(() => goOrder(id))}
          onPrintBill={(id) => whenOnline(() => printBill(id))}
          onPay={(id) => whenOnline(() => router.push(`${tabletOrder(id)}?pay=1`))}
          onTakeaway={() => whenOnline(() => router.push(`${TABLET_NEW_ORDER}?type=TAKEAWAY`))}
          onBarTab={openBarTab}
          onLock={onLock}
          grid={grid(4)}
        />
      </div>
    <div className="tb-portrait" data-tablet-tables style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column" }}>
      <header style={{ height: 96, flex: "none", display: "flex", alignItems: "center", gap: 14, padding: "0 24px", background: T.bar }}>
        <span style={{ fontSize: 38, fontWeight: 900, flex: 1 }}>Tables</span>
        <span data-user-chip style={{ height: 60, display: "flex", alignItems: "center", gap: 12, padding: "0 18px", borderRadius: 8, background: "#1F2226", fontSize: 20, fontWeight: 800 }}>
          <span style={{ width: 38, height: 38, borderRadius: "50%", background: T.teal, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15 }}>{user.initials}</span>
          {user.firstName}
        </span>
        <button type="button" className="tb-press" data-tablet-lock disabled={working} onClick={onLock} style={{ height: 60, padding: "0 22px", border: "none", borderRadius: 8, background: T.lockBg, color: T.lockFg, fontSize: 20, fontWeight: 900, fontFamily: "inherit", cursor: "pointer" }}>
          LOCK
        </button>
      </header>

      {areas.length > 1 && (
        <nav style={{ display: "grid", gridTemplateColumns: `repeat(${areaCols}, minmax(0, 1fr))`, gap: 8, padding: "14px 16px 0" }}>
          {areas.map((a) => {
            const on = a.id === areaId;
            return (
              <button
                key={a.id}
                type="button"
                className="tb-press"
                data-area-tab={a.name}
                aria-pressed={on}
                onClick={() => !on && whenOnline(() => router.replace(`${TABLET_TABLES}?area=${encodeURIComponent(a.id)}`))}
                style={{ height: 72, border: "none", borderRadius: 8, background: on ? T.text : T.button, color: on ? "#000" : T.text, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, fontFamily: "inherit", minWidth: 0, padding: "0 6px" }}
              >
                <span style={{ fontSize: 21, fontWeight: 900, maxWidth: "100%", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.name}</span>
                <span style={{ fontSize: 14, fontWeight: 700, opacity: 0.85 }}>{a.free}</span>
              </button>
            );
          })}
        </nav>
      )}

      <div style={{ display: "flex", gap: 8, padding: "12px 16px", alignItems: "center", flexWrap: "wrap" }}>
        {!user.manager && (
          <button type="button" className="tb-press" data-my-tables aria-pressed={mineOnly} onClick={() => setMineOnly(!mineOnly)} style={{ height: 52, padding: "0 20px", border: "none", borderRadius: 8, background: mineOnly ? T.teal : T.button, color: T.text, fontSize: 18, fontWeight: 800, fontFamily: "inherit", cursor: "pointer" }}>
            {mineOnly ? "My tables ✓" : "My tables"}
          </button>
        )}
        <div style={{ flex: 1 }} />
        {LEGEND.map((look) => (
          <span key={look} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 15, fontWeight: 700, color: T.soft }}>
            <span style={{ width: 16, height: 16, borderRadius: 4, background: LOOK_STYLE[look].bg, boxShadow: LOOK_STYLE[look].ring.replace("4px", "2px") }} />
            {lookLabel({ look, reservation: null })}
          </span>
        ))}
      </div>

      {grid(3)}

      <footer style={{ height: 108, flex: "none", display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10, padding: "12px 16px 16px", background: T.bar }}>
        <button type="button" className="tb-press" data-tablet-takeaway onClick={() => whenOnline(() => router.push(`${TABLET_NEW_ORDER}?type=TAKEAWAY`))} style={{ border: "none", borderRadius: 8, background: "#1F2226", color: T.text, fontSize: 22, fontWeight: 900, fontFamily: "inherit", cursor: "pointer" }}>
          TAKEAWAY
        </button>
        <button
          type="button"
          className="tb-press"
          data-tablet-bar-tab
          onClick={openBarTab}
          style={{ border: "none", borderRadius: 8, background: "#1F2226", color: T.text, fontSize: 22, fontWeight: 900, fontFamily: "inherit", cursor: "pointer" }}
        >
          BAR TAB
        </button>
      </footer>
    </div>

      {sheet?.kind === "guests" && (
        <TabletSheet title={`Table ${sheet.tile.name}`} aside="How many guests?" onClose={close} data="guests">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gridAutoRows: 112, gap: 10 }}>
            {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
              <SheetButton key={n} onClick={() => seat(sheet.tile, n)} disabled={working} fontSize={46} height={112} data={{ guests: String(n) }}>
                {n}
              </SheetButton>
            ))}
          </div>
          <SheetButton onClick={close} background={T.bar} color={T.soft} height={76} fontSize={20} data={{ "sheet-cancel": "" }}>
            Cancel
          </SheetButton>
        </TabletSheet>
      )}

      {sheet?.kind === "booking" && sheet.tile.reservation && (
        <TabletSheet title={`Table ${sheet.tile.name}`} aside={`Reserved ${sheet.tile.reservation.time}`} onClose={close} data="booking">
          <span style={{ fontSize: 24, fontWeight: 800 }}>
            {sheet.tile.reservation.guestName} · {sheet.tile.reservation.partySize} {sheet.tile.reservation.partySize === 1 ? "guest" : "guests"}
          </span>
          {can.book ? (
            <SheetButton onClick={() => seatBooking(sheet.tile)} disabled={working} background={T.teal} data={{ "seat-booking": "" }}>
              SEAT {sheet.tile.reservation.guestName.toUpperCase()}
            </SheetButton>
          ) : (
            <span style={{ fontSize: 18, fontWeight: 700, color: T.quiet }}>Seating a booking needs Manage Reservations. Ask a manager.</span>
          )}
          <SheetButton onClick={close} background={T.bar} color={T.soft} height={76} fontSize={20} data={{ "sheet-cancel": "" }}>
            Cancel
          </SheetButton>
        </TabletSheet>
      )}

      {sheet?.kind === "checks" && (
        <TabletSheet title={`Table ${sheet.tile.name}`} aside={`${sheet.tile.checks.length} checks`} onClose={close} data="checks">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
            {sheet.tile.checks.map((c) => (
              <SheetButton key={c.id} onClick={() => goOrder(c.id)} height={104} data={{ check: c.label }}>
                <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                  <span>{c.label}</span>
                  <span style={{ fontSize: 20, fontWeight: 800 }}>{c.total}</span>
                </span>
              </SheetButton>
            ))}
          </div>
          <SheetButton onClick={close} background={T.bar} color={T.soft} height={76} fontSize={20} data={{ "sheet-cancel": "" }}>
            Cancel
          </SheetButton>
        </TabletSheet>
      )}

      {sheet?.kind === "cleaning" && (
        <TabletSheet title={`Table ${sheet.tile.name}`} aside="Needs cleaning" onClose={close} data="cleaning">
          <SheetButton onClick={() => clean(sheet.tile)} disabled={working} background={T.teal} data={{ "mark-clean": "" }}>
            MARK CLEAN
          </SheetButton>
          <SheetButton onClick={close} background={T.bar} color={T.soft} height={76} fontSize={20} data={{ "sheet-cancel": "" }}>
            Cancel
          </SheetButton>
        </TabletSheet>
      )}

      {sheet?.kind === "barTab" && (
        <TabletSheet title="Bar tab" aside="Whose tab?" onClose={close} data="bar-tab">
          <div data-tab-name style={{ height: 84, display: "flex", alignItems: "center", padding: "0 22px", borderRadius: 8, background: T.bg, boxShadow: `inset 0 0 0 3px ${T.edge}`, fontSize: 34, fontWeight: 900, overflow: "hidden", whiteSpace: "nowrap" }}>
            {tabName || <span style={{ color: T.quiet, fontWeight: 700 }}>Name on the tab</span>}
          </div>
          <TabletKeyboard
            onKey={(k) => setTabName((n) => (n.length >= TAB_NAME_MAX ? n : (n + (n === "" || n.endsWith(" ") ? k.toUpperCase() : k)).replace(/^ +/, "")))}
            onDelete={() => setTabName((n) => n.slice(0, -1))}
            onClear={() => setTabName("")}
          />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10 }}>
            <SheetButton onClick={close} background={T.bar} color={T.lockFg} height={84} fontSize={21} data={{ "sheet-cancel": "" }}>
              CANCEL
            </SheetButton>
            <SheetButton onClick={() => whenOnline(() => router.push(`${TABLET_NEW_ORDER}?type=BAR_TAB&name=${encodeURIComponent(tabName.trim())}`))} disabled={!tabName.trim()} background={T.bar2} height={84} fontSize={22} data={{ "open-tab": "" }}>
              OPEN TAB
            </SheetButton>
          </div>
        </TabletSheet>
      )}

      {sheet?.kind === "endShift" && (
        <TabletSheet title="End your shift?" onClose={close} data="end-shift">
          <span style={{ fontSize: 20, fontWeight: 700, color: T.quiet }}>Locking keeps your shift on. End it if you&apos;re going home.</span>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <SheetButton onClick={() => lock(false)} disabled={working} data={{ "lock-only": "" }}>
              LOCK ONLY
            </SheetButton>
            <SheetButton onClick={() => lock(true)} disabled={working} background={T.lockBg} color={T.lockFg} data={{ "end-shift": "" }}>
              END SHIFT
            </SheetButton>
          </div>
        </TabletSheet>
      )}

      {sheet?.kind === "handover" && (
        <TabletSheet title="Hand over your tables" aside={`${sheet.orders} open`} onClose={close} data="handover">
          <span style={{ fontSize: 20, fontWeight: 700, color: T.quiet }}>Who takes them over?</span>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
            {sheet.to.map((p) => (
              <SheetButton key={p.id} onClick={() => lock(true, p.id)} disabled={working} height={96} data={{ "hand-to": p.name }}>
                {p.name}
                {p.onShift ? "" : " (off shift)"}
              </SheetButton>
            ))}
          </div>
          <SheetButton onClick={close} background={T.bar} color={T.soft} height={76} fontSize={20} data={{ "sheet-cancel": "" }}>
            Cancel
          </SheetButton>
        </TabletSheet>
      )}

      <TabletToast text={toast} />
    </>
  );
}
