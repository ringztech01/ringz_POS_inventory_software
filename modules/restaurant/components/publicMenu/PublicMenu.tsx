"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { MENU_STRINGS as S } from "../../lib/menuStrings";
import { matchesSearch, type MenuStatus, type MenuStatuses, type PublicMenuHeader, type PublicMenuItem, type PublicMenuSection, type PublicMenuWhere } from "../../lib/publicMenu";
import type { Department } from "../../lib/posGrid";
import { lighterStore } from "../../lib/menuDevice";
import type { GuestRequests } from "../../lib/tableRequests";
import { isUnderway, type GuestOrderLineView, type MenuOrdering } from "../../lib/guestOrdering";
import { ShoppingBag } from "lucide-react";
import ItemSheet, { LighterSwitch, type SheetOrdering } from "./ItemSheet";
import ServiceBar from "./ServiceBar";
import BasketSheet from "./BasketSheet";
import { basketStore } from "./basketStore";
import { menuMoney } from "./menuMoney";

// The guest's menu (Part 8 Step 3, design: RingzPOS Digital Menu). Light on
// purpose: system fonts, flat colours, no libraries. The server renders it;
// this adds the tabs, the group row, search, and the live availability
// check (every 30 s and when the page is back in view) that never moves
// what the guest is looking at. At a table, Call waiter / Request bill
// (Step 6) along the bottom; while one is outstanding the check runs every
// few seconds so the guest sees a waiter's on the way. With guest ordering
// on (Step 7), Add to order on each dish's sheet, the basket in the same
// dock, and this phone's own lines and where they are.

const FONT = `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;
const MONO = `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
const INK = "#171b1c";
const QUIET = "#6d777a";
const LINE = "#eceff0";
const POLL_MS = 30_000;
const POLL_WAITING_MS = 8_000;

type Props = {
  token: string;
  where: PublicMenuWhere;
  header: PublicMenuHeader;
  sections: PublicMenuSection[];
  items: PublicMenuItem[];
  departments: Department[];
  service: { buttons: { callWaiter: boolean; requestBill: boolean }; requests: GuestRequests } | null;
  ordering: MenuOrdering | null;
};

function Pill({ children, tone = "plain" }: { children: string; tone?: "plain" | "accent" | "warn" }) {
  const colours = tone === "accent" ? { bg: "#e7f4f1", fg: "#0a6355" } : tone === "warn" ? { bg: "#fdf2e9", fg: "#9a4a12" } : { bg: "#f1f4f4", fg: "#4d5659" };
  return <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 10, background: colours.bg, color: colours.fg, fontSize: 11, fontWeight: 600, lineHeight: "16px", whiteSpace: "nowrap" }}>{children}</span>;
}

// A card re-renders only when its own item or state changes — not when the
// detail sheet opens over the menu.
const Card = memo(function Card({ item, onOpen }: { item: PublicMenuItem & { status: MenuStatus }; onOpen: (id: string) => void }) {
  const out = item.status !== "available";
  return (
    <div
      data-menu-item={item.id}
      data-status={item.status}
      role="button"
      tabIndex={0}
      aria-label={item.name}
      onClick={() => onOpen(item.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(item.id);
        }
      }}
      style={{ display: "flex", gap: 12, padding: "14px 0", borderBottom: `1px solid ${LINE}`, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}
    >
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4, opacity: out ? 0.5 : 1 }}>
        <span style={{ fontSize: 15, fontWeight: 600, color: INK }}>{item.name}</span>
        {item.description && <span style={{ fontSize: 12.5, color: QUIET, lineHeight: 1.4 }}>{item.description}</span>}
        {(item.signature || item.spin || item.model || item.allergens.length > 0 || item.calories !== null) && (
          <span style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 2 }}>
            {item.signature && <Pill tone="accent">{S.signature}</Pill>}
            {item.spin && <Pill>{S.spin}</Pill>}
            {item.model && <Pill>{S.model}</Pill>}
            {item.allergens.map((a) => (
              <Pill key={a} tone="warn">
                {a}
              </Pill>
            ))}
            {item.calories !== null && <Pill>{S.calories(item.calories)}</Pill>}
          </span>
        )}
        {item.price && <span style={{ fontWeight: 600, color: "#0a6355", marginTop: 2, fontSize: 14.5 }}>{item.price}</span>}
      </div>
      <div style={{ width: 96, flex: "0 0 auto", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
        <div style={{ width: 96, height: 80, borderRadius: 10, background: "#eef1f2", overflow: "hidden", opacity: out ? 0.5 : 1 }}>
          {item.photo && (
            // eslint-disable-next-line @next/next/no-img-element -- a plain lazy image: no image server on the LAN, the file is already WebP
            <img src={item.photo.thumb} alt="" width={96} height={80} loading="lazy" decoding="async" style={{ width: 96, height: 80, objectFit: "cover", display: "block" }} />
          )}
        </div>
        {out && (
          <span data-menu-item-state style={{ fontSize: 11.5, fontWeight: 600, color: item.status === "sold_out" ? "#9a4a12" : QUIET, textAlign: "center", lineHeight: 1.25 }}>
            {item.status === "sold_out" ? S.soldOut : S.unavailable}
          </span>
        )}
      </div>
    </div>
  );
});

export default function PublicMenu({ token, where, header, sections, items, departments, service, ordering }: Props) {
  const [department, setDepartment] = useState<Department>(where.startDepartment);
  const [query, setQuery] = useState("");
  const [statuses, setStatuses] = useState<MenuStatuses>(() => Object.fromEntries(items.map((i) => [i.id, i.status])));
  const [offline, setOffline] = useState(false);
  const [requests, setRequests] = useState<GuestRequests | null>(service?.requests ?? null);
  // Guest ordering: paused or not (the live check keeps it current), this
  // phone's sent lines, the basket (kept on the phone), the basket sheet.
  const [orderState, setOrderState] = useState<{ paused: boolean; lines: GuestOrderLineView[] } | null>(ordering ? { paused: ordering.paused, lines: [] } : null);
  const basket = useSyncExternalStore(basketStore.subscribe, () => basketStore.get(token), basketStore.getServer);
  const [basketOpen, setBasketOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  // The dock's height: the menu leaves that much room below its last line.
  const dockRef = useRef<HTMLDivElement>(null);
  const checkNow = useRef<() => void>(() => undefined);
  const waiting = (!!requests && Object.values(requests).some((state) => state !== null)) || !!orderState?.lines.some((l) => isUnderway(l.stage));
  const [active, setActive] = useState<string | null>(null);
  // The item open in its detail sheet; the "Lighter menu" (remembered here).
  const [openId, setOpenId] = useState<string | null>(null);
  const lighter = useSyncExternalStore(lighterStore.subscribe, lighterStore.get, lighterStore.getServer);
  const barRef = useRef<HTMLDivElement>(null);
  // The card the guest is looking at, and where it was, across a refresh.
  const anchor = useRef<{ id: string; top: number } | null>(null);

  const searching = query.trim().length > 0;
  const visible = useMemo(
    () => items.filter((i) => i.id in statuses && (searching ? matchesSearch(i, query) : i.department === department)).map((i) => ({ ...i, status: statuses[i.id] })),
    [items, statuses, searching, query, department],
  );
  const shownSections = useMemo(() => sections.filter((s) => visible.some((i) => i.sectionId === s.id)), [sections, visible]);

  // Live availability: states change in place; an item no longer listed
  // goes. The card at the top of the screen stays where it was.
  useEffect(() => {
    let stopped = false;
    async function check() {
      try {
        const response = await fetch(`/menu/${encodeURIComponent(token)}/status`, { cache: "no-store" });
        if (response.status === 404) {
          window.location.reload();
          return;
        }
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as { statuses: MenuStatuses; requests: GuestRequests | null; order: { paused: boolean; lines: GuestOrderLineView[] } | null };
        if (stopped) return;
        setOrderState((before) => (body.order && before && JSON.stringify(before) === JSON.stringify(body.order) ? before : body.order));
        if (body.requests) setRequests((before) => (before && JSON.stringify(before) === JSON.stringify(body.requests) ? before : body.requests));
        const barBottom = barRef.current?.getBoundingClientRect().bottom ?? 0;
        const cards = [...document.querySelectorAll<HTMLElement>("[data-menu-item]")];
        const first = cards.find((c) => c.getBoundingClientRect().bottom > barBottom);
        anchor.current = first ? { id: first.dataset.menuItem ?? "", top: first.getBoundingClientRect().top } : null;
        setStatuses((before) => {
          const next: MenuStatuses = {};
          for (const id of Object.keys(before)) if (body.statuses[id]) next[id] = body.statuses[id];
          // Unchanged: the same object, so nothing re-renders.
          const same = Object.keys(next).length === Object.keys(before).length && Object.keys(next).every((id) => next[id] === before[id]);
          return same ? before : next;
        });
        setOffline(false);
      } catch {
        if (!stopped) setOffline(true);
      }
    }
    const timer = window.setInterval(check, waiting ? POLL_WAITING_MS : POLL_MS);
    checkNow.current = () => void check();
    const onShow = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onShow);
    window.addEventListener("focus", onShow);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onShow);
      window.removeEventListener("focus", onShow);
    };
  }, [token, waiting]);

  // This phone's own order, as soon as the page is up (ordering on).
  const ordersHere = !!ordering;
  useEffect(() => {
    if (ordersHere) checkNow.current();
  }, [ordersHere]);


  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useLayoutEffect(() => {
    const kept = anchor.current;
    anchor.current = null;
    if (!kept) return;
    const card = document.querySelector<HTMLElement>(`[data-menu-item="${CSS.escape(kept.id)}"]`);
    if (card) {
      const moved = card.getBoundingClientRect().top - kept.top;
      if (moved) window.scrollBy(0, moved);
    }
  }, [statuses]);

  // The group row follows the section on screen.
  useEffect(() => {
    if (searching || typeof IntersectionObserver === "undefined") return;
    const top = (barRef.current?.getBoundingClientRect().height ?? 0) + 8;
    const observer = new IntersectionObserver(
      (entries) => {
        const hit = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (hit) setActive((hit.target as HTMLElement).dataset.menuSection ?? null);
      },
      { rootMargin: `-${top}px 0px -60% 0px` },
    );
    document.querySelectorAll("[data-menu-section]").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [shownSections, searching]);

  const goTo = (id: string) => {
    const el = document.getElementById(`menu-section-${id}`);
    if (!el) return;
    const offset = (barRef.current?.getBoundingClientRect().height ?? 0) + 4;
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - offset, behavior: "smooth" });
    setActive(id);
  };

  const setLighter = lighterStore.set;

  // The sheet is a step in the phone's history: Back closes it.
  const openItem = useCallback((id: string) => {
    setOpenId(id);
    window.history.pushState({ menuItem: id }, "");
  }, []);
  // Closes at once; the history step it added is then taken back.
  const closeItem = useCallback(() => {
    setOpenId(null);
    if ((window.history.state as { menuItem?: string } | null)?.menuItem) window.history.back();
  }, []);
  useEffect(() => {
    // A reload keeps the history entry's state: a sheet that was open then
    // isn't now, so that entry mustn't say it is (Back would reopen it).
    const state = window.history.state as ({ menuItem?: string; menuBasket?: boolean } & Record<string, unknown>) | null;
    if (state?.menuItem || state?.menuBasket) {
      const rest = { ...state };
      delete rest.menuItem;
      delete rest.menuBasket;
      window.history.replaceState(rest, "");
    }
    const onPop = (e: PopStateEvent) => {
      const next = e.state as { menuItem?: string; menuBasket?: boolean } | null;
      setOpenId(next?.menuItem ?? null);
      setBasketOpen(!!next?.menuBasket);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const openItemData = openId ? items.find((i) => i.id === openId) : undefined;

  // The basket sheet is a step in the phone's history too.
  const openBasket = useCallback(() => {
    setBasketOpen(true);
    window.history.pushState({ menuBasket: true }, "");
  }, []);
  const closeBasket = useCallback(() => {
    setBasketOpen(false);
    if ((window.history.state as { menuBasket?: boolean } | null)?.menuBasket) window.history.back();
  }, []);
  const basketCount = basket.reduce((n, l) => n + l.quantity, 0);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const basketTotal = basket.every((l) => byId.get(l.productId)?.kobo != null)
    ? basket.reduce((sum, l) => {
        const item = byId.get(l.productId)!;
        const extra = item.modifiers.flatMap((g) => g.options).filter((o) => l.modifierIds.includes(o.id)).reduce((n, o) => n + (o.kobo ?? 0), 0);
        return sum + ((item.kobo ?? 0) + extra) * l.quantity;
      }, 0)
    : null;
  const sentWaiting = orderState?.lines.filter((l) => l.stage === "waiting").length ?? 0;
  const showOrderButton = !!ordering && (basket.length > 0 || (orderState?.lines.length ?? 0) > 0);
  const sheetOrdering = useMemo<SheetOrdering | null>(
    () =>
      ordering && orderState
        ? {
            paused: orderState.paused,
            accent: header.accent,
            onAdd: (line) => {
              if (!openId) return;
              basketStore.add(token, { productId: openId, ...line });
              const name = items.find((i) => i.id === openId)?.name ?? "";
              closeItem();
              setNotice(S.added(name));
            },
          }
        : null,
    [ordering, orderState, header.accent, openId, token, items, closeItem],
  );
  const anyRich = items.some((i) => i.spinFrames || i.modelFiles);

  // The dock's height, measured before the page is painted (and again
  // whenever it changes): the menu leaves that much room below its last
  // line, so nothing hides under the dock and a tap on the last group
  // scrolls as far as it should. Written straight onto <main> — not state,
  // so measuring never re-renders the menu (a re-render on every open of a
  // dish cost the slowed phone ~0.5 s).
  const dockShown = showOrderButton || (!!service && !!requests) || !!notice;
  useLayoutEffect(() => {
    const el = dockRef.current;
    const measure = () => {
      if (mainRef.current) mainRef.current.style.paddingBottom = `${40 + (el ? Math.ceil(el.getBoundingClientRect().height) : 0)}px`;
    };
    measure();
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [dockShown]);

  const accent = header.accent;
  return (
    <div style={{ minHeight: "100vh", background: "#fafbfb", color: INK, fontFamily: FONT, maxWidth: 640, margin: "0 auto" }}>
      <header data-menu-header style={{ padding: "22px 20px 14px", background: accent, color: "#fff", display: "flex", flexDirection: "column", gap: 4 }}>
        {header.logo && (
          // eslint-disable-next-line @next/next/no-img-element -- the business's own logo file, served on the LAN
          <img src={header.logo} alt="" height={36} style={{ height: 36, width: "auto", alignSelf: "flex-start", marginBottom: 4 }} />
        )}
        <span data-menu-where style={{ fontFamily: MONO, fontSize: 11.5, opacity: 0.85, textTransform: "uppercase" }}>
          {where.title}
          {where.area ? ` · ${where.area}` : ""}
        </span>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600, lineHeight: 1.2 }}>{header.title}</h1>
        {header.notes.length > 0 && <span style={{ fontSize: 12.5, opacity: 0.85 }}>{header.notes.join(" · ")}</span>}
        {header.welcome && <p style={{ margin: "6px 0 0", fontSize: 13, opacity: 0.95, lineHeight: 1.4 }}>{header.welcome}</p>}
      </header>

      <div ref={barRef} data-menu-bar style={{ position: "sticky", top: 0, zIndex: 5, background: "#fff", borderBottom: `1px solid ${LINE}` }}>
        <div style={{ display: "flex", gap: 8, padding: "10px 16px 0", alignItems: "center" }}>
          {departments.length > 1 &&
            departments.map((d) => {
              const on = d === department && !searching;
              return (
                <button
                  key={d}
                  type="button"
                  data-menu-tab={d}
                  aria-pressed={on}
                  onClick={() => {
                    setQuery("");
                    setDepartment(d);
                    window.scrollTo({ top: 0 });
                  }}
                  style={{ height: 34, padding: "0 16px", border: "none", borderBottom: `3px solid ${on ? accent : "transparent"}`, background: "none", color: on ? INK : QUIET, fontSize: 14, fontWeight: 700, fontFamily: FONT, cursor: "pointer" }}
                >
                  {d === "FOOD" ? S.food : S.bar}
                </button>
              );
            })}
          <input
            type="search"
            data-menu-search
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={S.searchPlaceholder}
            aria-label={S.searchPlaceholder}
            enterKeyHint="search"
            style={{ flex: 1, minWidth: 0, height: 34, border: `1px solid #dde2e3`, borderRadius: 17, padding: "0 14px", fontSize: 14, fontFamily: FONT, background: "#f6f8f8", color: INK, outline: "none" }}
          />
        </div>
        {!searching && (
          <div data-menu-groups style={{ display: "flex", gap: 8, padding: "10px 16px 12px", overflowX: "auto", scrollbarWidth: "none" }}>
            {shownSections.map((s) => {
              const on = s.id === (active ?? shownSections[0]?.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  data-menu-group={s.name}
                  onClick={() => goTo(s.id)}
                  style={{ flex: "0 0 auto", height: 34, padding: "0 14px", borderRadius: 17, border: `1px solid ${on ? accent : "#dde2e3"}`, background: on ? accent : "#fff", color: on ? "#fff" : "#4d5659", fontSize: 13, fontWeight: 600, fontFamily: FONT, cursor: "pointer" }}
                >
                  {s.name}
                </button>
              );
            })}
          </div>
        )}
        {offline && (
          <div data-menu-offline role="status" style={{ padding: "6px 16px", fontSize: 12, background: "#fdf2e9", color: "#9a4a12" }}>
            {S.offline}
          </div>
        )}
      </div>

      <main ref={mainRef} style={{ padding: "4px 16px 40px" }}>
        {items.length === 0 ? (
          <p data-menu-empty style={{ color: QUIET, fontSize: 14, padding: "24px 0" }}>
            {S.emptyMenu}
          </p>
        ) : searching ? (
          visible.length === 0 ? (
            <p data-menu-no-results style={{ color: QUIET, fontSize: 14, padding: "24px 0" }}>
              {S.noResults(query.trim())}
            </p>
          ) : (
            visible.map((item) => <Card key={item.id} item={item} onOpen={openItem} />)
          )
        ) : (
          shownSections.map((s) => (
            <section key={s.id} id={`menu-section-${s.id}`} data-menu-section={s.id}>
              <h2 style={{ margin: "18px 0 0", fontSize: 13, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: QUIET }}>{s.name}</h2>
              {visible
                .filter((i) => i.sectionId === s.id)
                .map((item) => (
                  <Card key={item.id} item={item} onOpen={openItem} />
                ))}
            </section>
          ))
        )}
        {header.footer && <p style={{ margin: "24px 0 0", fontSize: 12.5, color: QUIET, textAlign: "center", lineHeight: 1.5 }}>{header.footer}</p>}
        {anyRich && (
          <div style={{ margin: "24px 0 0", paddingTop: 16, borderTop: `1px solid ${LINE}` }}>
            <LighterSwitch on={lighter} onChange={setLighter} />
          </div>
        )}
      </main>
      {dockShown && (
        <div ref={dockRef} data-menu-dock style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 6, display: "flex", justifyContent: "center", pointerEvents: "none" }}>
          <div style={{ boxSizing: "border-box", width: "100%", maxWidth: 640, background: "#fff", borderTop: `1px solid ${LINE}`, boxShadow: "0 -4px 16px rgba(23,27,28,.06)", padding: "10px 16px calc(10px + env(safe-area-inset-bottom))", display: "flex", flexDirection: "column", gap: 8, pointerEvents: "auto" }}>
            {notice && (
              <span data-menu-notice role="status" style={{ fontSize: 13, fontWeight: 600, color: "#0a6355" }}>
                {notice}
              </span>
            )}
            {showOrderButton && (
              <button
                type="button"
                data-basket-open
                onClick={openBasket}
                style={{ height: 50, border: "none", borderRadius: 12, background: basket.length ? INK : "#fff", color: basket.length ? "#fff" : INK, boxShadow: basket.length ? "none" : "inset 0 0 0 1px #dde2e3", fontFamily: FONT, fontSize: 15, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "0 16px", cursor: "pointer" }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <ShoppingBag size={18} aria-hidden />
                  {basket.length ? S.viewBasket(basketCount) : S.orderStatus(sentWaiting)}
                </span>
                {basket.length > 0 && basketTotal !== null && <span data-basket-bar-total>{menuMoney(basketTotal, items.find((i) => i.price)?.price ?? null)}</span>}
              </button>
            )}
            {service && requests && <ServiceBar token={token} where={where.title} buttons={service.buttons} requests={requests} accent={accent} onRequests={setRequests} />}
          </div>
        </div>
      )}
      {openItemData && (
        <ItemSheet item={openItemData} status={statuses[openItemData.id] ?? openItemData.status} lighter={lighter} onLighter={setLighter} onClose={closeItem} ordering={sheetOrdering} />
      )}
      {basketOpen && ordering && orderState && (
        <BasketSheet
          token={token}
          items={items}
          basket={basket}
          sent={orderState.lines}
          mode={ordering.mode}
          where={ordering.where}
          paused={orderState.paused}
          accent={accent}
          onSent={(message) => {
            setNotice(message);
            checkNow.current();
          }}
          onClose={closeBasket}
        />
      )}
    </div>
  );
}
