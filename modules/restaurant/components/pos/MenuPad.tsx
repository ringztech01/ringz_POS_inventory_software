"use client";

import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { DEPARTMENT_COLOR, DEPARTMENT_LABEL, DEPARTMENTS, GRID_SLOTS, gridPage, pageCount, type Department } from "../../lib/posGrid";
import { groupPath } from "../../lib/posMenu";
import { shortPrice } from "../../lib/optionFlow";
import { TOUCH } from "../../lib/theme";
import type { MenuCard, OrderScreenData } from "../../server/queries/orderScreen";
import TouchButton from "./TouchButton";

// The groups row: seven keys (more groups than that: six and "More ›").
const ROW_SLOTS = 7;
const LONG_PRESS_MS = 450;
const IDLE_INK: Record<Department, string> = { FOOD: TOUCH.foodIdleInk, BAR: TOUCH.barIdleInk };
// Names are bold 15 px and never cut; a long one steps down a size so it
// still fits its key.
const nameSize = (name: string) => (name.length <= 30 ? 15 : name.length <= 42 ? 14 : 13);

function EmptyCell() {
  return <div aria-hidden style={{ background: TOUCH.empty, borderRadius: TOUCH.radius }} />;
}

// A grid key's two lines: the name on top; the price (or "3 items") and
// the badge along the bottom.
function Face({ name, sub, badge }: { name: string; sub: string; badge: string }) {
  return (
    <>
      <span style={{ fontSize: nameSize(name), fontWeight: 700, lineHeight: 1.2, textWrap: "pretty", overflowWrap: "anywhere" }}>{name}</span>
      <span style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 4 }}>
        <span style={{ fontFamily: TOUCH.mono, fontSize: 13, fontWeight: 600, opacity: 0.92, fontVariantNumeric: "tabular-nums" }}>{sub}</span>
        <span aria-hidden style={{ fontSize: 18, fontWeight: 700, lineHeight: 1 }}>
          {badge}
        </span>
      </span>
    </>
  );
}

const tileStyle = { position: "relative", display: "flex", flexDirection: "column", justifyContent: "space-between", alignItems: "stretch", textAlign: "left", padding: "9px 10px" } as const;

// A dish: a tap adds it (or opens its options when a group is required — the
// "•"); a long press opens its options even when they're all optional (the
// "+"). 86 (switched off or out of stock): grey, can't be tapped.
function ItemButton({ item, color, locked, onPick, onLongPick }: { item: MenuCard; color: string; locked: boolean; onPick: (item: MenuCard) => void; onLongPick?: (item: MenuCard) => void }) {
  const out = item.unavailable !== null;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);
  const stopTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  return (
    <TouchButton
      data-item={item.name}
      data-86={out || undefined}
      data-extras={(item.hasOptions && !item.requiredOptions) || undefined}
      background={out ? TOUCH.outBg : color}
      color={out ? TOUCH.outInk : "#fff"}
      disabled={out}
      aria-label={out ? `${item.name} — 86, not available` : `${item.name} ${item.price}`}
      onPointerDown={() => {
        longPressed.current = false;
        stopTimer();
        if (onLongPick && item.hasOptions)
          timer.current = setTimeout(() => {
            longPressed.current = true;
            onLongPick(item);
          }, LONG_PRESS_MS);
      }}
      onPointerUp={stopTimer}
      onPointerLeave={stopTimer}
      onPointerCancel={stopTimer}
      onContextMenu={(event) => event.preventDefault()}
      onClick={() => {
        if (longPressed.current) {
          longPressed.current = false;
          return;
        }
        onPick(item);
      }}
      style={{ ...tileStyle, cursor: out ? "not-allowed" : "pointer", opacity: locked && !out ? 0.55 : 1 }}
    >
      <Face name={item.name} sub={shortPrice(item.price)} badge={out ? "86" : item.requiredOptions ? "•" : item.hasOptions ? "+" : ""} />
    </TouchButton>
  );
}

// A sub-group in the grid: dark, ringed in its colour, "3 items ›".
function SubGroupButton({ name, color, count, onOpen }: { name: string; color: string; count: number; onOpen: () => void }) {
  return (
    <TouchButton data-group={name} background={TOUCH.key} onClick={onOpen} style={{ ...tileStyle, boxShadow: `inset 0 0 0 3px ${color}` }}>
      <Face name={name} sub={`${count} item${count === 1 ? "" : "s"}`} badge="›" />
    </TouchButton>
  );
}

// The touch POS's right side (the Restaurant POS design): FOOD · BAR ·
// search; the department's groups in one row (the open one lit in its
// colour); the crumb bar — Back (up a level, or out of a panel), "Food ›
// Rice", what the next dish gets ("Next item × 3"), and the pages when a
// group has more than 30 keys; then the fixed 6 × 5 grid of the group's
// sub-groups and dishes, in the cells set in Food › POS buttons. A
// department opens on its first group. Adding a dish leaves the grid where
// it is — or, with the "back to home" setting, returns to the top group. A
// panel (a dish's options, the Note or Qty pad) takes the grid's place; a
// tap on a department or group closes it.
export default function MenuPad({
  menu,
  locked,
  returnHome = false,
  onPick,
  onLongPick,
  overlay,
  overlayCrumb,
  overlayFull = false,
  onLeaveOverlay,
  onOverlayBack,
  onSearch,
  chips,
}: {
  menu: OrderScreenData["menu"];
  locked: boolean;
  returnHome?: boolean;
  onPick: (item: MenuCard) => void;
  onLongPick?: (item: MenuCard) => void;
  // Shown in the grid's place.
  overlay?: ReactNode;
  // Its step on the crumb ("Options").
  overlayCrumb?: string;
  // Over the whole menu side, not just the grid (Search, with its keyboard).
  overlayFull?: boolean;
  onLeaveOverlay?: () => void;
  // Back while a panel is open (a step back, or out of it).
  onOverlayBack?: () => void;
  // The magnifier: quick search for a rare dish.
  onSearch?: () => void;
  // On the crumb bar's right: "Next item × 3".
  chips?: ReactNode;
}) {
  const { tree } = menu;
  const dishes = useMemo(() => new Map(menu.items.map((item) => [item.id, item])), [menu.items]);
  const [department, setDepartment] = useState<Department>("FOOD");
  const [levelId, setLevelId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [rowPage, setRowPage] = useState(0);

  const row = tree.row[department];
  // The open group: the one picked (if it's still on this side), else the
  // department's first.
  const level = (levelId && tree.groups[levelId]?.department === department ? levelId : null) ?? row[0] ?? null;
  const path = groupPath(tree, level);
  const cells = level ? (tree.grids[level] ?? []) : tree.home[department];
  const pages = pageCount(cells.length);
  const shownPage = Math.min(page, pages - 1);
  const rowPages = row.length > ROW_SLOTS ? Math.ceil(row.length / (ROW_SLOTS - 1)) : 1;
  const shownRowPage = Math.min(rowPage, rowPages - 1);
  const rowGroups = rowPages > 1 ? row.slice(shownRowPage * (ROW_SLOTS - 1), (shownRowPage + 1) * (ROW_SLOTS - 1)) : row;
  const colourOf = (id: string) => tree.groups[id]?.colour ?? TOUCH.key;
  const canGoUp = path.length > 1;

  function open(id: string | null) {
    setLevelId(id);
    setPage(0);
  }
  function home(next: Department) {
    onLeaveOverlay?.();
    setDepartment(next);
    setRowPage(0);
    open(null);
  }
  function openFromRow(id: string) {
    onLeaveOverlay?.();
    open(id);
  }
  function pick(item: MenuCard) {
    onPick(item);
    if (returnHome && !locked) open(path[0] ?? null);
  }
  function back() {
    if (overlay) return (onOverlayBack ?? onLeaveOverlay)?.();
    if (canGoUp) open(path.at(-2) ?? null);
  }

  // Esc: up one level — unless a panel or pop-up is open (it has its own Esc).
  const up = path.at(-2) ?? null;
  useEffect(() => {
    if (overlay || !canGoUp) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape" || document.querySelector('[role="dialog"]')) return;
      setLevelId(up);
      setPage(0);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [overlay, canGoUp, up]);

  const backLit = !!overlay || canGoUp;
  const crumbs = [DEPARTMENT_LABEL[department], ...path.map((id) => tree.groups[id]?.name ?? ""), ...(overlay && overlayCrumb ? [overlayCrumb] : [])];
  const pageKey = { width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 3 } as const;

  return (
    <section aria-label="Menu" data-pos-menu style={{ display: "flex", flexDirection: "column", gap: TOUCH.gap, minHeight: 0, minWidth: 0, position: "relative" }}>
      {overlay && overlayFull && <div style={{ position: "absolute", inset: 0, zIndex: 6 }}>{overlay}</div>}
      <div role="group" aria-label="Departments" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr) 64px", gap: TOUCH.gap, flexShrink: 0 }}>
        {DEPARTMENTS.map((d) => {
          const on = d === department;
          return (
            <TouchButton
              key={d}
              data-department={d}
              aria-pressed={on}
              background={on ? DEPARTMENT_COLOR[d] : TOUCH.key}
              color={on ? "#fff" : IDLE_INK[d]}
              onClick={() => home(d)}
              style={{ height: 54, fontFamily: TOUCH.display, fontSize: 20, fontWeight: 700, letterSpacing: ".04em" }}
            >
              {DEPARTMENT_LABEL[d].toUpperCase()}
            </TouchButton>
          );
        })}
        <TouchButton data-pos-search aria-label="Search dishes" title="Search" background={TOUCH.key} disabled={!onSearch} onClick={onSearch} style={{ height: 54, display: "flex", alignItems: "center", justifyContent: "center", opacity: onSearch ? 1 : 0.45 }}>
          <Search size={22} strokeWidth={1.8} />
        </TouchButton>
      </div>

      <div aria-label="Groups" style={{ display: "grid", gridTemplateColumns: `repeat(${ROW_SLOTS}, minmax(0,1fr))`, gap: TOUCH.gap, height: 58, flexShrink: 0 }}>
        {Array.from({ length: ROW_SLOTS }, (_, i) => {
          if (rowPages > 1 && i === ROW_SLOTS - 1)
            return (
              <TouchButton key="more" data-groups-more aria-label="More groups" background={TOUCH.key} onClick={() => setRowPage((shownRowPage + 1) % rowPages)} style={{ fontSize: 15, fontWeight: 700 }}>
                More ›
              </TouchButton>
            );
          const id = rowGroups[i];
          if (!id) return <EmptyCell key={`empty-${i}`} />;
          const on = id === path[0];
          const colour = colourOf(id);
          return (
            <TouchButton
              key={id}
              data-group={tree.groups[id].name}
              aria-pressed={on}
              background={on ? colour : TOUCH.key}
              pressedBackground={on ? undefined : TOUCH.keyDown}
              onClick={() => openFromRow(id)}
              style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.15, padding: "0 6px", boxShadow: on ? "inset 0 -4px 0 rgba(0,0,0,.35)" : `inset 0 -4px 0 ${colour}`, overflowWrap: "anywhere" }}
            >
              {tree.groups[id].name}
            </TouchButton>
          );
        })}
      </div>

      <div data-pos-crumbs style={{ height: 44, flexShrink: 0, display: "flex", alignItems: "center", gap: 8, background: TOUCH.header, borderRadius: TOUCH.radius, padding: "0 4px", minWidth: 0 }}>
        <TouchButton
          data-pos-back
          background={backLit ? DEPARTMENT_COLOR[department] : TOUCH.key}
          color={backLit ? "#fff" : TOUCH.muted}
          disabled={!backLit}
          onClick={back}
          style={{ height: 36, display: "flex", alignItems: "center", gap: 6, padding: "0 14px", borderRadius: 3, fontSize: 14, fontWeight: 700, flexShrink: 0 }}
        >
          <ChevronLeft size={14} strokeWidth={2.6} />
          Back
        </TouchButton>
        <nav aria-label="Breadcrumb" data-pos-breadcrumb style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 600, color: TOUCH.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {crumbs.map((name, i) => (
            <Fragment key={`${name}-${i}`}>
              {i > 0 && <span aria-hidden>{"  ›  "}</span>}
              <span>{name}</span>
            </Fragment>
          ))}
        </nav>
        {chips}
        {!overlay && pages > 1 && (
          <div data-pos-pages style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
            <TouchButton aria-label="Previous page" background={TOUCH.key} disabled={shownPage === 0} onClick={() => setPage(shownPage - 1)} style={{ ...pageKey, opacity: shownPage === 0 ? 0.35 : 1 }}>
              <ChevronLeft size={20} strokeWidth={2.4} />
            </TouchButton>
            <span data-pos-page style={{ minWidth: 44, textAlign: "center", fontFamily: TOUCH.mono, fontSize: 14, fontWeight: 600, color: TOUCH.text }}>
              {shownPage + 1} / {pages}
            </span>
            <TouchButton aria-label="Next page" background={TOUCH.key} disabled={shownPage >= pages - 1} onClick={() => setPage(shownPage + 1)} style={{ ...pageKey, opacity: shownPage >= pages - 1 ? 0.35 : 1 }}>
              <ChevronRight size={20} strokeWidth={2.4} />
            </TouchButton>
          </div>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", position: "relative" }}>
        {overlay ? (
          <div style={{ flex: 1, minHeight: 0, position: "relative" }}>{overlayFull ? null : overlay}</div>
        ) : (
          <div
            aria-label={level ? `${tree.groups[level]?.name} buttons` : `${DEPARTMENT_LABEL[department]} buttons`}
            data-pos-grid
            style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "repeat(6, minmax(0,1fr))", gridTemplateRows: "repeat(5, minmax(0,1fr))", gap: TOUCH.gap }}
          >
            {gridPage(cells, shownPage).map((cell, i) => {
              const at = shownPage * GRID_SLOTS + i;
              if (cell?.kind === "group" && tree.groups[cell.id])
                return <SubGroupButton key={`g-${cell.id}`} name={tree.groups[cell.id].name} color={colourOf(cell.id)} count={(tree.grids[cell.id] ?? []).filter((c) => c !== null).length} onOpen={() => open(cell.id)} />;
              const item = cell?.kind === "item" ? dishes.get(cell.id) : undefined;
              if (item) return <ItemButton key={`i-${item.id}`} item={item} color={colourOf(tree.dishGroup[item.id])} locked={locked} onPick={pick} onLongPick={onLongPick} />;
              return <EmptyCell key={`empty-${at}`} />;
            })}
          </div>
        )}
      </div>
    </section>
  );
}
