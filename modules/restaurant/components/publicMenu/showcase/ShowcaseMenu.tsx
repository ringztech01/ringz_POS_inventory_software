"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { MENU_STRINGS } from "../../../lib/menuStrings";
import { matchesSearch, type MenuStatus, type PublicMenuHeader, type PublicMenuItem, type PublicMenuSection, type PublicMenuWhere } from "../../../lib/publicMenu";
import type { Department } from "../../../lib/posGrid";
import { lighterStore } from "../../../lib/menuDevice";
import type { GuestRequests } from "../../../lib/tableRequests";
import type { MenuOrdering } from "../../../lib/guestOrdering";
import { addsStraightAway, greeting, headline, mediaBadge, trackerStep, TRACK_STAGES } from "../../../lib/showcaseMenu";
import { basketStore } from "../basketStore";
import { menuMoney } from "../menuMoney";
import { Plate } from "./ShowcaseStage";
import ShowcaseDish, { type DishOrdering } from "./ShowcaseDish";
import ShowcaseBasket from "./ShowcaseBasket";
import ShowcaseService, { WaiterButton } from "./ShowcaseService";
import { historyStep, useMenuLive } from "./useMenuLive";
import css from "./showcase.module.css";

// The guest's menu in the Showcase design (design: RingzPOS Digital Menu
// v2), the default look; Classic (PublicMenu) is the other choice in
// Digital menu › QR codes. Dark and warm: a greeting with the table, Food /
// Drinks, the chef's signatures in a row to swipe, sticky group chips and
// dish cards with a + to add. A dish opens over the menu with its photo,
// 360° or 3D view (only those it really has). Along the bottom: the Waiter
// button (Call waiter / Request bill) and the order. Everything else — the
// live check, guest ordering's rules, what's sent — is the same as Classic.

const S = MENU_STRINGS;
const T = MENU_STRINGS.showcase;

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

type Shown = PublicMenuItem & { status: MenuStatus };

function Badge({ item }: { item: { spin: boolean; model: boolean } }) {
  const badge = mediaBadge(item);
  if (!badge) return null;
  return <span className={`${css.thumbBadge} ${badge === "3D" ? css.badge3d : css.badgeSpinSolid}`}>{badge}</span>;
}

const Card = memo(function Card({ item, canAdd, onOpen, onAdd }: { item: Shown; canAdd: boolean; onOpen: (id: string) => void; onAdd: (id: string) => void }) {
  const out = item.status !== "available";
  return (
    <div
      data-menu-item={item.id}
      data-status={item.status}
      role="button"
      tabIndex={0}
      aria-label={item.name}
      className={css.card}
      onClick={() => onOpen(item.id)}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onOpen(item.id);
        }
      }}
    >
      <div className={css.thumb}>
        <Plate photo={item.photo} name={item.name} className={css.thumbPlate} sizes="thumb" />
        <Badge item={item} />
      </div>
      <div className={css.cardBody}>
        <span className={css.cardName}>{item.name}</span>
        {item.description && <span className={css.cardDesc}>{item.description}</span>}
        <div className={css.cardFoot}>
          {item.price ? <span className={css.price}>{item.price}</span> : <span />}
          {canAdd && !out && (
            <button
              type="button"
              data-card-add={item.id}
              aria-label={T.add(item.name)}
              className={css.plus}
              onClick={(e) => {
                e.stopPropagation();
                onAdd(item.id);
              }}
            >
              +
            </button>
          )}
          {out && (
            <span data-menu-item-state className={css.out}>
              {item.status === "sold_out" ? S.soldOut : S.unavailable}
            </span>
          )}
        </div>
      </div>
    </div>
  );
});

const search = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
);

const itemStep = historyStep("menuItem");
const basketStep = historyStep("menuBasket");
const helpStep = historyStep("menuHelp");

export default function ShowcaseMenu({ token, where, header, sections, items, departments, service, ordering }: Props) {
  const [department, setDepartment] = useState<Department>(where.startDepartment);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [basketOpen, setBasketOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  // The phone's clock, for "Good evening" (the server's may differ a little).
  const [hour] = useState(() => new Date().getHours());
  const barRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const lighter = useSyncExternalStore(lighterStore.subscribe, lighterStore.get, lighterStore.getServer);
  const basket = useSyncExternalStore(basketStore.subscribe, () => basketStore.get(token), basketStore.getServer);
  const { statuses, offline, requests, setRequests, orderState, checkNow } = useMenuLive({
    token,
    items,
    requests: service?.requests ?? null,
    ordering,
    stickyBottom: () => barRef.current?.getBoundingClientRect().bottom ?? 0,
  });

  const say = useCallback((text: string) => setToast(text), []);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

  const searching = query.trim().length > 0;
  const listed = useMemo(() => items.filter((i) => i.id in statuses).map((i): Shown => ({ ...i, status: statuses[i.id] })), [items, statuses]);
  const visible = useMemo(() => listed.filter((i) => (searching ? matchesSearch(i, query) : i.department === department)), [listed, searching, query, department]);
  const shownSections = useMemo(() => sections.filter((s) => visible.some((i) => i.sectionId === s.id)), [sections, visible]);
  const signatures = useMemo(() => (searching ? [] : listed.filter((i) => i.signature && i.department === department && i.status === "available")), [listed, searching, department]);
  const anyRich = useMemo(() => items.some((i) => i.spinFrames || i.modelFiles), [items]);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const canAdd = !!ordering && !!orderState && !orderState.paused;

  // The chips follow the section on screen.
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
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
  }, [shownSections]);
  // …and keep the active one in view.
  useEffect(() => {
    if (!active) return;
    const chip = barRef.current?.querySelector<HTMLElement>(`[data-menu-group-id="${CSS.escape(active)}"]`);
    const row = chip?.parentElement;
    if (chip && row) row.scrollTo({ left: chip.offsetLeft - 20, behavior: "smooth" });
  }, [active]);

  const goTo = (id: string) => {
    const el = document.getElementById(`menu-section-${id}`);
    if (!el) return;
    const offset = (barRef.current?.getBoundingClientRect().height ?? 0) + 4;
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - offset, behavior: "smooth" });
    setActive(id);
  };

  // Sheets are steps in the phone's history: Back closes them.
  const openItem = useCallback((id: string) => {
    setOpenId(id);
    itemStep.push(id);
  }, []);
  const closeItem = useCallback(() => {
    setOpenId(null);
    itemStep.back();
  }, []);
  const openBasket = useCallback(() => {
    setBasketOpen(true);
    basketStep.push();
  }, []);
  const closeBasket = useCallback(() => {
    setBasketOpen(false);
    basketStep.back();
  }, []);
  const openHelp = useCallback(() => {
    setHelpOpen(true);
    helpStep.push();
  }, []);
  const closeHelp = useCallback(() => {
    setHelpOpen(false);
    helpStep.back();
  }, []);
  useEffect(() => {
    // A reload keeps the history entry's state: a sheet that was open then
    // isn't now, so that entry mustn't say it is.
    const state = window.history.state as Record<string, unknown> | null;
    if (state?.menuItem || state?.menuBasket || state?.menuHelp) {
      const rest = { ...state };
      delete rest.menuItem;
      delete rest.menuBasket;
      delete rest.menuHelp;
      window.history.replaceState(rest, "");
    }
    const onPop = (e: PopStateEvent) => {
      const next = e.state as { menuItem?: string; menuBasket?: boolean; menuHelp?: boolean } | null;
      setOpenId(next?.menuItem ?? null);
      setBasketOpen(!!next?.menuBasket);
      setHelpOpen(!!next?.menuHelp);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // "+" on a card: straight into the order when nothing needs choosing,
  // otherwise the dish opens to choose.
  const quickAdd = useCallback(
    (id: string) => {
      const item = byId.get(id);
      if (!item) return;
      if (!addsStraightAway(item.modifiers)) return openItem(id);
      basketStore.add(token, { productId: id, modifierIds: [], note: "", quantity: 1 });
      say(T.addedOne(item.name));
    },
    [byId, openItem, say, token],
  );

  const dishOrdering = useMemo<DishOrdering | null>(
    () =>
      ordering && orderState
        ? {
            paused: orderState.paused,
            onAdd: (line) => {
              if (!openId) return;
              basketStore.add(token, { productId: openId, ...line });
              closeItem();
              say(S.added(byId.get(openId)?.name ?? ""));
            },
          }
        : null,
    [ordering, orderState, openId, token, closeItem, say, byId],
  );

  const basketCount = basket.reduce((n, l) => n + l.quantity, 0);
  const basketTotal = basket.every((l) => byId.get(l.productId)?.kobo != null)
    ? basket.reduce((sum, l) => {
        const item = byId.get(l.productId)!;
        const extra = item.modifiers.flatMap((g) => g.options).filter((o) => l.modifierIds.includes(o.id)).reduce((n, o) => n + (o.kobo ?? 0), 0);
        return sum + ((item.kobo ?? 0) + extra) * l.quantity;
      }, 0)
    : null;
  const sentLines = orderState?.lines ?? [];
  const step = trackerStep(sentLines.map((l) => l.stage));
  const showBag = !!ordering && (basket.length > 0 || sentLines.length > 0);
  const showWaiter = !!service && !!requests && (service.buttons.callWaiter || service.buttons.requestBill);
  const sample = items.find((i) => i.price)?.price ?? null;
  const openItemData = openId ? byId.get(openId) : undefined;
  const whereUpper = where.title.toUpperCase();
  const deptName = (d: Department) => (d === "FOOD" ? S.food : T.drinks);
  const notes = [...header.notes, ...(header.footer ? [header.footer] : [])];

  return (
    <div className={css.root} data-design="showcase">
      <style>{`html, body { background: #14100D; }`}</style>
      <header className={css.header} data-menu-header>
        <div className={css.brand}>
          <span className={css.mark} aria-hidden>
            {header.logo ? (
              // eslint-disable-next-line @next/next/no-img-element -- the business's own logo file, served on the LAN
              <img src={header.logo} alt="" width={34} height={34} style={{ width: 34, height: 34, objectFit: "cover", background: "#F5EDE1" }} />
            ) : (
              (header.title.trim()[0] ?? "R").toUpperCase()
            )}
          </span>
          <h1 className={css.brandName} style={{ margin: 0 }}>
            {header.title}
          </h1>
        </div>
        <span className={css.where} data-menu-where title={where.area ? `${where.title} · ${where.area}` : where.title}>
          {where.title}
        </span>
        <button
          type="button"
          className={css.round}
          aria-label={searchOpen ? T.closeSearch : T.search}
          aria-expanded={searchOpen}
          data-menu-search-toggle
          onClick={() => {
            if (searchOpen) setQuery("");
            setSearchOpen(!searchOpen);
          }}
        >
          {searchOpen ? <span style={{ fontSize: 22, lineHeight: 1 }}>×</span> : search}
        </button>
      </header>

      {searchOpen && (
        <div className={css.search}>
          <input
            ref={searchRef}
            type="search"
            data-menu-search
            className={css.searchInput}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={T.searchPlaceholder}
            aria-label={T.searchPlaceholder}
            enterKeyHint="search"
          />
        </div>
      )}

      <section className={css.hero}>
        <span className={css.eyebrow} suppressHydrationWarning>
          {greeting(hour)} · {whereUpper}
        </span>
        <h2 className={css.headline} suppressHydrationWarning>
          {headline(searching ? "FOOD" : department, hour)}
        </h2>
        {header.welcome ? (
          <p className={css.lede}>{header.welcome}</p>
        ) : anyRich ? (
          <p className={css.lede}>
            {T.lede[0]}
            <b>{S.model}</b>
            {T.lede[1]}
            <b>{S.spin}</b>
            {T.lede[2]}
          </p>
        ) : (
          <p className={css.lede}>{T.ledePlain}</p>
        )}
      </section>

      {departments.length > 1 && !searching && (
        <div className={css.depts}>
          <div className={css.deptsInner}>
            {departments.map((d) => (
              <button
                key={d}
                type="button"
                data-menu-tab={d}
                aria-pressed={d === department}
                className={css.dept}
                onClick={() => {
                  setDepartment(d);
                  setActive(null);
                  window.scrollTo({ top: 0 });
                }}
              >
                {deptName(d)}
                <span className={css.deptCount}>{listed.filter((i) => i.department === d).length}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {signatures.length > 0 && (
        <section className={css.sigs} data-menu-signatures>
          <div className={css.sigsHead}>
            <h2 className={css.sectionTitle}>{T.signatures}</h2>
            {signatures.length > 1 && <span className={css.swipe}>{T.swipe}</span>}
          </div>
          <div className={css.sigRow}>
            {signatures.map((item) => (
              <button key={item.id} type="button" className={css.sig} data-signature={item.id} onClick={() => openItem(item.id)}>
                <div className={css.sigImage}>
                  <Plate photo={item.photo} name={item.name} className={css.sigPlate} sizes="thumb" />
                  {(item.model || item.spin) && (
                    <div className={css.badges}>
                      {item.model && <span className={`${css.badge} ${css.badge3d}`}>{S.model}</span>}
                      {item.spin && <span className={`${css.badge} ${css.badgeSpin}`}>{S.spin}</span>}
                    </div>
                  )}
                </div>
                <div className={css.sigBody}>
                  <span className={css.sigName}>{item.name}</span>
                  <span className={css.sigFoot}>
                    <span className={css.sigPrice}>{item.price ?? ""}</span>
                    <span className={css.sigCta}>
                      {item.model && !lighter ? T.explore3d : item.spin && !lighter ? T.explore360 : T.view}
                      <span className={css.arrow} aria-hidden>
                        →
                      </span>
                    </span>
                  </span>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      <nav ref={barRef} className={css.chipsBar} data-menu-bar>
        {shownSections.length > 0 && (
          <div className={css.chips} data-menu-groups>
            {shownSections.map((s) => (
              <button key={s.id} type="button" className={css.chip} data-menu-group={s.name} data-menu-group-id={s.id} aria-current={s.id === (active ?? shownSections[0]?.id)} onClick={() => goTo(s.id)}>
                {s.name}
              </button>
            ))}
          </div>
        )}
        {offline && (
          <div data-menu-offline role="status" className={css.offline}>
            {S.offline}
          </div>
        )}
      </nav>

      <main style={{ paddingBottom: showBag || showWaiter ? "calc(120px + env(safe-area-inset-bottom))" : 40 }}>
        {items.length === 0 ? (
          <p data-menu-empty className={css.empty}>
            {S.emptyMenu}
          </p>
        ) : visible.length === 0 ? (
          <p data-menu-no-results className={css.empty}>
            {S.noResults(query.trim())}
          </p>
        ) : (
          shownSections.map((s) => {
            const list = visible.filter((i) => i.sectionId === s.id);
            return (
              <section key={s.id} id={`menu-section-${s.id}`} data-menu-section={s.id} className={css.section}>
                <div className={css.sectionHead}>
                  <h2 className={css.sectionName}>{s.name}</h2>
                  <span className={css.sectionCount}>{T.items(list.length)}</span>
                </div>
                <div className={css.grid}>
                  {list.map((item) => (
                    <Card key={item.id} item={item} canAdd={canAdd} onOpen={openItem} onAdd={quickAdd} />
                  ))}
                </div>
              </section>
            );
          })
        )}
        {notes.length > 0 && <p className={css.foot}>{notes.join(" · ")}</p>}
        {anyRich && (
          <label className={css.lighter} data-lighter-menu>
            <input type="checkbox" checked={lighter} onChange={(e) => lighterStore.set(e.target.checked)} />
            <span>
              <b>{S.lighterMenu}</b>
              <span>{S.lighterHelp}</span>
            </span>
          </label>
        )}
      </main>

      {(showBag || showWaiter) && (
        <div className={css.dock} data-menu-dock>
          <div className={css.dockInner}>
            {showWaiter && requests && <WaiterButton requests={requests} onOpen={openHelp} />}
            {showBag && (
              <button type="button" data-basket-open className={css.bag} onClick={openBasket}>
                <span className={css.bagLabel}>{basket.length ? T.yourOrder(basketCount) : T.orderStatus}</span>
                <span className={css.bagTotal} data-basket-bar-total>
                  {basket.length ? (basketTotal !== null ? menuMoney(basketTotal, sample) : basketCount) : step >= 0 ? (TRACK_STAGES[step] === "waiting" && ordering?.where !== "table" ? T.trackPoint : T.track[TRACK_STAGES[step]]) : S.sent}
                </span>
              </button>
            )}
          </div>
        </div>
      )}

      {toast && (
        <div className={css.toast} role="status" data-menu-notice>
          {toast}
        </div>
      )}

      {openItemData && (
        <ShowcaseDish
          key={openItemData.id}
          item={openItemData}
          status={statuses[openItemData.id] ?? openItemData.status}
          lighter={lighter}
          showSwitch={anyRich}
          ordering={dishOrdering}
          onClose={closeItem}
          say={say}
        />
      )}
      {basketOpen && ordering && orderState && (
        <ShowcaseBasket
          token={token}
          items={items}
          basket={basket}
          sent={orderState.lines}
          mode={ordering.mode}
          where={ordering.where}
          paused={orderState.paused}
          onSent={(message) => {
            say(message);
            checkNow();
          }}
          onClose={closeBasket}
        />
      )}
      {helpOpen && service && requests && <ShowcaseService token={token} where={where.title} buttons={service.buttons} requests={requests} onRequests={setRequests} onClose={closeHelp} say={say} />}
    </div>
  );
}
