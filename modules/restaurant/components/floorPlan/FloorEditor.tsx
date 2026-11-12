"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type PointerEvent as ReactPointerEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import {
  clamp,
  clampToRoom,
  duplicateNumbers,
  firstFreeSpot,
  FIXTURE_DEFAULTS,
  FIXTURE_TYPES,
  GRID_SIZES_M,
  insideRoom,
  isTenthMetre,
  MAX_SEATS,
  MIN_SIZE_M,
  nextTableNumber,
  overlappingTables,
  ROOM_LIMITS_M,
  round2,
  SHAPE_SIZE,
  snap,
  TABLE_PALETTE,
  type FixtureType,
  type TableShape,
} from "../../lib/floorGeometry";
import { calibrate, FLOOR_IMAGE_ACCEPT, floorImageProblem, imageBox, OPACITY_LIMITS, type Point } from "../../lib/floorImage";
import { TOUCH } from "../../lib/theme";
import { LAYOUT_NAME_MAX, NORMAL_NAME } from "../../lib/floorLayouts";
import { reachText } from "../../lib/floorRules";
import {
  adjustFloorBackground,
  deleteFloorPlanLayout,
  getFloorReach,
  removeFloorBackground,
  saveFloorPlan,
  saveFloorPlanLayout,
  setFloorPlanLock,
  switchFloorPlanLayout,
  uploadFloorBackground,
} from "../../server/actions/floorPlan";
import type { EditorArea } from "../../server/queries/floorPlan";

type Geometry = { x: number; y: number; w: number; h: number; rotation: number };
// busy: why it can't be taken off the plan (an open order, a booking today).
type TableItem = Geometry & { key: string; id?: string; kind: "table"; name: string; seats: number; shape: TableShape; busy?: string | null };
type FixtureItem = Geometry & { key: string; id?: string; kind: "fixture"; type: FixtureType; label: string };
type Item = TableItem | FixtureItem;
type Room = EditorArea["room"];
// An area as it's being edited: its room (size and grid) and what's in it.
type Plan = { room: Room; items: Item[] };
type Plans = Record<string, Plan>;

const HISTORY = 50;
const SHAPES: TableShape[] = ["ROUND", "SQUARE", "RECT", "BOOTH"];
const C = {
  frame: "#1E2228",
  panel: "#15181C",
  key: "#2B3139",
  keyDown: "#3A424C",
  line: "#2C323A",
  canvas: "#171A1E",
  room: "#1B1F24",
  dot: "#353C45",
  roomEdge: "#4A535D",
  text: "#FFFFFF",
  dim: "#AEB6BE",
  faint: "#6D777A",
  teal: "#0F7D6A",
  green: "#3DD68C",
  amber: "#F2B233",
  bad: "#5A1E22",
  badRing: "#FF8A8D",
  badText: "#B3261E",
  void: "#8E2328",
  pay: "#13804A",
  idle: "#3A3F46",
  ink: "#171B1C",
  inkDim: "#4D5659",
  strip: "#F1F3F4",
  edge: "#D5DADD",
} as const;

const toItems = (area: EditorArea): Item[] => [
  ...area.tables.map((t): Item => ({ key: t.id, id: t.id, kind: "table", name: t.name, seats: t.seats, shape: t.shape, x: t.x, y: t.y, w: t.w, h: t.h, rotation: t.rotation, busy: t.busy })),
  ...area.fixtures.map((f): Item => ({ key: f.id, id: f.id, kind: "fixture", type: f.type, label: f.label, x: f.x, y: f.y, w: f.w, h: f.h, rotation: f.rotation })),
];
const fromAreas = (areas: EditorArea[]): Plans => Object.fromEntries(areas.map((a) => [a.id, { room: a.room, items: toItems(a) }]));
const same = (a: Plan | undefined, b: Plan | undefined) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const tablesOf = (plan: Plan | undefined) => (plan?.items ?? []).filter((i): i is TableItem => i.kind === "table");
// "1.4 m", "0.25 m".
const m = (value: number) => `${Number.isInteger(Math.round(value * 10)) && Math.abs(value * 10 - Math.round(value * 10)) < 1e-6 ? value.toFixed(1) : value.toFixed(2)} m`;
const itemName = (item: Item) => (item.kind === "table" ? item.name : item.label);
const UNREACHABLE = "Couldn't reach the server. Check the connection and try again.";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
// New tables and fixtures get their ids once saved: written into every copy
// of the plan (on screen, saved, and the undo history), so Undo after a save
// still points at the same rows.
const withIds = (plans: Plans, created: Record<string, string>): Plans =>
  Object.fromEntries(Object.entries(plans).map(([id, plan]) => [id, { ...plan, items: plan.items.map((i) => (!i.id && created[i.key] ? { ...i, id: created[i.key] } : i)) }]));

// The floor plan editor (the Floor Plan Editor design): an area's room drawn
// to scale on a dot grid, its tables and fixtures dragged into place (snap
// to grid, the corner resizes, arrows nudge, Delete removes), added from
// the palette at the first free spot, checked as you go (overlapping
// tables and repeated numbers turn red; SAVE waits until they're fixed),
// and saved — every changed area at once, against the version it was
// opened at. Undo / Redo keep the last 50 steps. Mouse and touch alike.
export default function FloorEditor({ areas, role }: { areas: EditorArea[]; role: { name: string; admin: boolean } }) {
  const router = useRouter();
  const [areaId, setAreaId] = useState(areas[0]?.id ?? "");
  const [meta, setMeta] = useState(areas);
  const [plans, setPlans] = useState<Plans>(() => fromAreas(areas));
  const [saved, setSaved] = useState<Plans>(() => fromAreas(areas));
  const [past, setPast] = useState<Plans[]>([]);
  const [future, setFuture] = useState<Plans[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [snapOn, setSnapOn] = useState(true);
  const [trace, setTrace] = useState(false);
  const [toast, setToastText] = useState("");
  const toastMs = useRef(2200);
  // A message at the bottom of the room for a couple of seconds (longer
  // when there's more to read).
  const setToast = (text: string, ms = 2200) => {
    toastMs.current = ms;
    setToastText(text);
  };
  const [saving, setSaving] = useState(false);
  // Someone else saved an area first: "Layout changed by Grace M. Reload?"
  const [stale, setStale] = useState<{ areaId: string; message: string } | null>(null);
  // Leaving with unsaved changes: where to, once saved or discarded.
  const [leaving, setLeaving] = useState<string | null>(null);
  // Areas to take afresh from the server when it next sends them (Reload).
  const [resetIds, setResetIds] = useState<string[]>([]);
  const [stage, setStage] = useState({ w: 860, h: 560 });
  const stageRef = useRef<HTMLElement>(null);
  const newKeys = useRef(0);

  // Fresh data from the server (after a save, an upload, another admin's
  // change): areas not being edited here take it. An area with edits in
  // progress keeps them — and keeps the version they were made from, so its
  // save is still checked against that and can never quietly overwrite what
  // someone else saved meanwhile. Reload (resetIds) takes the server's.
  const [seenAreas, setSeenAreas] = useState(areas);
  if (seenAreas !== areas) {
    setSeenAreas(areas);
    const fresh = fromAreas(areas);
    const keep = (id: string) => !!plans[id] && !same(plans[id], saved[id]) && !resetIds.includes(id);
    setMeta(areas.map((a) => {
      const base = meta.find((m) => m.id === a.id);
      return keep(a.id) && base ? { ...a, layoutVersion: base.layoutVersion } : a;
    }));
    setPlans(Object.fromEntries(areas.map((a) => [a.id, keep(a.id) ? plans[a.id] : fresh[a.id]])));
    setSaved(Object.fromEntries(areas.map((a) => [a.id, keep(a.id) ? saved[a.id] : fresh[a.id]])));
    if (resetIds.length) setResetIds([]);
  }

  const area = meta.find((a) => a.id === areaId) ?? meta[0];
  const room = plans[area?.id ?? ""]?.room ?? area?.room ?? { widthM: 12, heightM: 8, gridM: 0.5 };
  const items = plans[area?.id ?? ""]?.items ?? [];
  const locked = !!area?.isLocked;
  const px = Math.max(10, Math.min((stage.w - 40) / room.widthM, (stage.h - 96) / room.heightM));
  const selected = items.find((i) => i.key === sel) ?? null;

  // Checks: overlaps in this area; table numbers across every area.
  const tables = items.filter((i): i is TableItem => i.kind === "table");
  const overlaps = overlappingTables(tables);
  const allTables = Object.values(plans).flatMap(tablesOf);
  const dupes = duplicateNumbers(allTables);
  const dupHere = tables.filter((t) => dupes.has(t.key));
  const conflicts = overlaps.size + dupHere.length;
  const dirtyIds = meta.filter((a) => !same(plans[a.id], saved[a.id])).map((a) => a.id);
  const blockedElsewhere = dirtyIds.some((id) => id !== area?.id && (overlappingTables(tablesOf(plans[id])).size > 0 || tablesOf(plans[id]).some((i) => dupes.has(i.key))));
  const canSave = dirtyIds.length > 0 && conflicts === 0 && !blockedElsewhere && !saving;

  // The stage's size: the room is drawn as large as fits.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setStage({ w: entry.contentRect.width, h: entry.contentRect.height }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // The area tabs scroll sideways when they don't all fit: the cut edge
  // fades, the mouse wheel scrolls them, and the open area is kept in view.
  const tabsRef = useRef<HTMLElement>(null);
  const [tabFade, setTabFade] = useState({ left: false, right: false });
  const measureTabs = () => {
    const el = tabsRef.current;
    if (!el) return;
    const next = { left: el.scrollLeft > 1, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 1 };
    setTabFade((now) => (now.left === next.left && now.right === next.right ? now : next));
  };
  useEffect(() => {
    const el = tabsRef.current;
    if (!el) return;
    const observer = new ResizeObserver(measureTabs);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    tabsRef.current?.querySelector("[aria-current=page]")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [areaId]);
  const tabMask = tabFade.left || tabFade.right ? `linear-gradient(to right, ${tabFade.left ? "transparent, #000 28px" : "#000"}, ${tabFade.right ? "#000 calc(100% - 28px), transparent" : "#000"})` : undefined;

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToastText(""), toastMs.current);
    return () => clearTimeout(timer);
  }, [toast]);

  function setItems(next: Item[], record = true) {
    if (!area) return;
    if (record) {
      setPast((p) => [...p.slice(-(HISTORY - 1)), plans]);
      setFuture([]);
    }
    setPlans((p) => ({ ...p, [area.id]: { room: p[area.id]?.room ?? room, items: next } }));
  }
  function setRoom(next: Room) {
    if (!area) return;
    setPast((p) => [...p.slice(-(HISTORY - 1)), plans]);
    setFuture([]);
    setPlans((p) => ({ ...p, [area.id]: { room: next, items: p[area.id]?.items ?? [] } }));
  }
  const update = (key: string, change: (item: Item) => Item, record = true) => setItems(items.map((i) => (i.key === key ? change(i) : i)), record);
  const fit = <T extends Item>(item: T): T => clampToRoom(item, room);
  const guard = () => {
    if (locked) setToast("This area is locked — unlock it to change the layout.");
    return locked;
  };

  // ---- Dragging (move, or resize from the corner) ----
  const drag = useRef<{ key: string; areaId: string; mode: "move" | "resize"; sx: number; sy: number; orig: Item; before: Plans; moved: boolean } | null>(null);
  const live = useRef({ px, room, snapOn });
  useEffect(() => {
    live.current = { px, room, snapOn };
  });
  useEffect(() => {
    function onMove(event: PointerEvent) {
      const d = drag.current;
      if (!d) return;
      const { px: scale, room: r, snapOn: on } = live.current;
      const dx = (event.clientX - d.sx) / scale;
      const dy = (event.clientY - d.sy) / scale;
      if (!d.moved && Math.abs(dx) < 0.02 && Math.abs(dy) < 0.02) return;
      d.moved = true;
      const o = d.orig;
      let next: Item;
      if (d.mode === "move") next = { ...o, x: Math.max(0, snap(o.x + dx, r.gridM, on)), y: Math.max(0, snap(o.y + dy, r.gridM, on)) };
      else {
        const min = o.kind === "table" ? MIN_SIZE_M.table : MIN_SIZE_M.fixture;
        let w = clamp(snap(o.w + dx, r.gridM, on), min, r.widthM);
        let h = clamp(snap(o.h + dy, r.gridM, on), min, r.heightM);
        if (o.kind === "table" && o.shape === "ROUND") w = h = Math.max(w, h);
        next = { ...o, w, h };
      }
      const fitted = clampToRoom(next, r);
      setPlans((p) => {
        const current = p[d.areaId];
        return current ? { ...p, [d.areaId]: { ...current, items: current.items.map((i) => (i.key === d.key ? fitted : i)) } } : p;
      });
    }
    function onUp() {
      const d = drag.current;
      drag.current = null;
      if (d?.moved) {
        setPast((p) => [...p.slice(-(HISTORY - 1)), d.before]);
        setFuture([]);
      }
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, []);

  function startDrag(event: ReactPointerEvent, item: Item, mode: "move" | "resize") {
    event.stopPropagation();
    setSel(item.key);
    if (locked || !area) return;
    drag.current = { key: item.key, areaId: area.id, mode, sx: event.clientX, sy: event.clientY, orig: item, before: plans, moved: false };
  }

  // ---- Adding, duplicating, removing ----
  function newTableNumber(extra: string[] = []) {
    const areaNames = tables.map((t) => t.name);
    return nextTableNumber(area?.prefix ?? null, areaNames, [...allTables.map((t) => t.name), ...extra]);
  }
  function addTable(shape: TableShape, seats: number, w: number, h: number) {
    if (guard()) return;
    const spot = firstFreeSpot(items, w, h, room, room.gridM);
    const item: TableItem = { key: `new-${++newKeys.current}`, kind: "table", name: newTableNumber(), seats, shape, ...spot, w, h, rotation: 0 };
    setItems([...items, item]);
    setSel(item.key);
  }
  function addFixture(type: FixtureType) {
    if (guard()) return;
    const { label, w, h } = FIXTURE_DEFAULTS[type];
    const fw = Math.min(w, room.widthM);
    const fh = Math.min(h, room.heightM);
    const spot = firstFreeSpot(items, fw, fh, room, room.gridM);
    const item: FixtureItem = { key: `new-${++newKeys.current}`, kind: "fixture", type, label, ...spot, w: fw, h: fh, rotation: 0 };
    setItems([...items, item]);
    setSel(item.key);
  }
  function duplicate() {
    if (!selected || guard()) return;
    const spot = firstFreeSpot(items, selected.w, selected.h, room, room.gridM);
    const copy: Item =
      selected.kind === "table"
        ? { ...selected, key: `new-${++newKeys.current}`, id: undefined, name: newTableNumber(), busy: null, ...spot }
        : { ...selected, key: `new-${++newKeys.current}`, id: undefined, ...spot };
    setItems([...items, copy]);
    setSel(copy.key);
  }
  function remove() {
    if (!selected || guard()) return;
    // An open order or a booking today: it stays, and you're told why (the
    // save checks again).
    if (selected.kind === "table" && selected.busy) return setToast(selected.busy, 4500);
    setItems(items.filter((i) => i.key !== selected.key));
    setSel(null);
  }
  function undo() {
    if (!past.length) return;
    setFuture((f) => [plans, ...f].slice(0, HISTORY));
    setPlans(past[past.length - 1]);
    setPast((p) => p.slice(0, -1));
  }
  function redo() {
    if (!future.length) return;
    setPast((p) => [...p.slice(-(HISTORY - 1)), plans]);
    setPlans(future[0]);
    setFuture((f) => f.slice(1));
  }

  // ---- Keys: arrows nudge one grid step (Shift: five), Delete removes ----
  const keys = useRef<{ nudge: (dx: number, dy: number) => void; remove: () => void; undo: () => void; redo: () => void } | null>(null);
  useEffect(() => {
    keys.current = {
      nudge: (dx: number, dy: number) => {
        if (!selected || guard()) return;
        update(selected.key, (i) => fit({ ...i, x: Math.max(0, round2(i.x + dx * room.gridM)), y: Math.max(0, round2(i.y + dy * room.gridM)) }));
      },
      remove,
      undo,
      redo,
    };
  });
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      const step = event.shiftKey ? 5 : 1;
      const arrows: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (arrows[event.key]) {
        event.preventDefault();
        keys.current?.nudge(...arrows[event.key]);
      } else if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        keys.current?.remove();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) keys.current?.redo();
        else keys.current?.undo();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
        event.preventDefault();
        keys.current?.redo();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // ---- Save, lock ----
  // SAVE: every changed area in one go. Then the toast follows the service
  // screens as they pick it up: "Saved v13 · 3 tablets updated". True once
  // saved (and the page may be left); false when it wasn't.
  async function save(): Promise<boolean> {
    if (saving) return false;
    if (!canSave) {
      if (conflicts || blockedElsewhere) setToast("Fix the red tables first.");
      return false;
    }
    const sent = Object.fromEntries(dirtyIds.map((id) => [id, plans[id]]));
    const payload = {
      areas: dirtyIds.map((id) => ({
        areaId: id,
        layoutVersion: meta.find((a) => a.id === id)!.layoutVersion,
        room: plans[id].room,
        tables: tablesOf(plans[id]).map((t) => ({ id: t.id, key: t.id ? undefined : t.key, name: t.name.trim(), seats: t.seats, shape: t.shape, x: t.x, y: t.y, w: t.w, h: t.h, rotation: t.rotation })),
        fixtures: (plans[id]?.items ?? [])
          .filter((i): i is FixtureItem => i.kind === "fixture")
          .map((f) => ({ id: f.id, key: f.id ? undefined : f.key, type: f.type, label: f.label.trim(), x: f.x, y: f.y, w: f.w, h: f.h, rotation: f.rotation })),
      })),
    };
    setSaving(true);
    const result = await saveFloorPlan(payload).catch(() => ({ ok: false as const, error: UNREACHABLE }));
    setSaving(false);
    if (!result.ok) {
      if ("stale" in result && result.stale && result.areaId) setStale({ areaId: result.areaId, message: result.error });
      else setToast(result.error, 4500);
      return false;
    }
    // Saved: what was sent is the saved plan now, new items with their ids.
    setSaved((s) => withIds({ ...s, ...sent }, result.created));
    setPlans((p) => withIds(p, result.created));
    setPast((h) => h.map((snapshot) => withIds(snapshot, result.created)));
    setFuture((h) => h.map((snapshot) => withIds(snapshot, result.created)));
    setMeta((list) => list.map((a) => (result.versions[a.id] ? { ...a, layoutVersion: result.versions[a.id] } : a)));
    setSel(null);
    router.refresh();
    void followReach(result.versions);
    return true;
  }
  // Only the latest save's follow-up speaks (an older one still counting
  // stops quietly).
  const reachRun = useRef(0);
  async function followReach(versions: Record<string, number>, saidAs?: string) {
    const run = ++reachRun.current;
    const ids = Object.keys(versions);
    const label = saidAs ?? (ids.length === 1 ? `Saved v${versions[ids[0]]}` : `Saved ${ids.map((id) => `${meta.find((a) => a.id === id)?.name ?? ""} v${versions[id]}`).join(", ")}`);
    setToast(reachText(label, null), 10000);
    let reach: { showing: number; updated: number } | null = null;
    // The screens refresh every 5 s: give them up to 8.
    for (let i = 0; i < 8; i++) {
      await sleep(1000);
      if (run !== reachRun.current) return;
      const result = await getFloorReach({ versions }).catch(() => null);
      if (!result?.ok) continue;
      reach = { showing: result.showing, updated: result.updated };
      if (reach.updated >= reach.showing) break;
    }
    if (run !== reachRun.current) return;
    setToast(reachText(label, reach ?? { showing: 0, updated: 0 }), 5000);
  }
  // "Reload" on a stale save: that area as the server has it now (your
  // changes there are dropped), and the undo history starts again.
  function reloadArea(areaId: string) {
    setStale(null);
    setResetIds((ids) => [...ids, areaId]);
    setPast([]);
    setFuture([]);
    setSel(null);
    setAreaId(areaId);
    setToast(`Reloaded ${meta.find((a) => a.id === areaId)?.name ?? "the area"} · showing the latest saved layout`, 3500);
    router.refresh();
  }
  async function toggleLock() {
    if (!area || saving) return;
    const target = area;
    const next = !target.isLocked;
    setSaving(true);
    const result = await setFloorPlanLock({ areaId: target.id, locked: next }).catch(() => ({ ok: false as const, error: UNREACHABLE }));
    setSaving(false);
    if (!result.ok) return setToast(result.error);
    setMeta((list) => list.map((a) => (a.id === target.id ? { ...a, isLocked: next } : a)));
    if (next) setSel(null);
    setToast(next ? `${target.name} is locked — nothing can be moved until you unlock it.` : `${target.name} is unlocked.`);
  }

  // ---- Event layouts (Step 5): Save as layout…, Switch layout, Restore
  // normal. Both work on the area as saved, so they wait until its changes
  // are saved (or undone).
  const activeLayout = area?.layouts.find((l) => l.isActive) ?? null;
  const [layoutDialog, setLayoutDialog] = useState<null | "save" | "switch">(null);
  const [layoutName, setLayoutName] = useState("");
  const [layoutError, setLayoutError] = useState("");
  const [layoutExists, setLayoutExists] = useState(false);
  const [layoutBusy, setLayoutBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  function openLayouts(which: "save" | "switch") {
    if (!area) return;
    if (dirtyIds.includes(area.id)) return setToast(`Save or undo your changes to ${area.name} first.`, 3500);
    setLayoutError("");
    setLayoutExists(false);
    setConfirmDelete(null);
    setLayoutName(which === "save" ? (activeLayout?.name ?? "") : "");
    setLayoutDialog(which);
  }
  async function saveLayout(replace: boolean) {
    if (!area || layoutBusy) return;
    const target = area;
    setLayoutBusy(true);
    const result = await saveFloorPlanLayout({ areaId: target.id, name: layoutName, replace }).catch(() => ({ ok: false as const, error: UNREACHABLE }));
    setLayoutBusy(false);
    if (!result.ok) {
      if ("exists" in result && result.exists) {
        setLayoutExists(true);
        return setLayoutError("");
      }
      return setLayoutError(result.error);
    }
    setLayoutDialog(null);
    setToast(`${result.replaced ? "Replaced" : "Saved as"} “${layoutName.trim()}” · Switch layout puts it on the floor`, 4000);
    router.refresh();
  }
  async function switchTo(layoutId: string | null) {
    if (!area || layoutBusy) return;
    const target = area;
    setLayoutBusy(true);
    setLayoutError("");
    const result = await switchFloorPlanLayout({ areaId: target.id, layoutVersion: target.layoutVersion, layoutId }).catch(() => ({ ok: false as const, error: UNREACHABLE }));
    setLayoutBusy(false);
    if (!result.ok) {
      if ("stale" in result && result.stale && result.areaId) {
        setLayoutDialog(null);
        return setStale({ areaId: result.areaId, message: result.error });
      }
      return setLayoutError(result.error);
    }
    setLayoutDialog(null);
    // The floor changed under the editor: take the server's copy, start the
    // undo history again.
    setResetIds((ids) => [...ids, target.id]);
    setPast([]);
    setFuture([]);
    setSel(null);
    router.refresh();
    const version = result.versions[target.id];
    void followReach(result.versions, layoutId ? `“${result.name}” is on the floor · v${version}` : `${NORMAL_NAME} restored · v${version}`);
  }
  async function removeLayout(id: string) {
    if (layoutBusy) return;
    if (confirmDelete !== id) return setConfirmDelete(id);
    setLayoutBusy(true);
    const result = await deleteFloorPlanLayout({ layoutId: id }).catch(() => ({ ok: false as const, error: UNREACHABLE }));
    setLayoutBusy(false);
    setConfirmDelete(null);
    if (!result.ok) return setLayoutError(result.error);
    setMeta((list) => list.map((a) => ({ ...a, layouts: a.layouts.filter((l) => l.id !== id) })));
    router.refresh();
  }

  // ---- Leaving with unsaved changes: Save / Discard (Exit), or the
  // browser's own "Leave site?" when the tab is closed or reloaded.
  const dirty = dirtyIds.length > 0;
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);
  async function saveAndLeave() {
    const to = leaving;
    if (!to) return;
    if (await save()) {
      setLeaving(null);
      router.push(to);
    }
  }

  // ---- Room size (Step 3): metres, in steps of 10 cm; the dot grid ----
  // Applied to the plan (undoable, saved with SAVE). Refused while anything
  // would fall outside the smaller room.
  const [roomEdit, setRoomEdit] = useState<{ w: string; h: string; grid: number; error: string } | null>(null);
  function openRoomEdit() {
    if (guard()) return;
    setRoomEdit(roomEdit ? null : { w: String(room.widthM), h: String(room.heightM), grid: room.gridM, error: "" });
  }
  function applyRoom() {
    if (!roomEdit || !area) return;
    const w = Number(roomEdit.w.trim().replace(",", "."));
    const h = Number(roomEdit.h.trim().replace(",", "."));
    const fail = (error: string) => setRoomEdit({ ...roomEdit, error });
    if (!roomEdit.w.trim() || !roomEdit.h.trim() || !Number.isFinite(w) || !Number.isFinite(h)) return fail("Enter the width and depth in metres.");
    if (w < ROOM_LIMITS_M.min || h < ROOM_LIMITS_M.min || w > ROOM_LIMITS_M.max || h > ROOM_LIMITS_M.max) return fail(`A room is ${ROOM_LIMITS_M.min}–${ROOM_LIMITS_M.max} m each way.`);
    if (!isTenthMetre(w) || !isTenthMetre(h)) return fail("Room sizes go in steps of 10 cm.");
    const next = { widthM: w, heightM: h, gridM: roomEdit.grid };
    const outside = items.find((i) => !insideRoom(i, next));
    if (outside) return fail(`${outside.kind === "table" ? `Table ${outside.name}` : outside.label} would be outside a ${w} × ${h} m room. Move it first.`);
    setRoomEdit(null);
    if (next.widthM === room.widthM && next.heightM === room.heightM && next.gridM === room.gridM) return;
    setRoom(next);
    setToast(`${area.name} is now ${w} × ${h} m · SAVE to keep it.`);
  }

  // ---- The floor plan image (Step 3): Administrator only ----
  // Uploaded, replaced, removed, faded and calibrated through the server
  // (which checks the role again and logs each change). Shown under the
  // grid while Trace image is on; never on the service screens.
  const bg = area?.background ?? null;
  const fileRef = useRef<HTMLInputElement>(null);
  const [imageBusy, setImageBusy] = useState<"" | "upload" | "remove" | "calibrate">("");
  const [natural, setNatural] = useState<Record<string, { w: number; h: number }>>({});
  const [opacityDraft, setOpacityDraft] = useState<Record<string, number>>({});
  const opacityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [calib, setCalib] = useState<{ areaId: string; points: Point[]; distance: string } | null>(null);
  const calibHere = calib && calib.areaId === area?.id ? calib : null;
  const nat = bg ? natural[bg.url] : undefined;
  const box = bg && nat ? imageBox(room, nat, bg.calibration) : null;
  const opacity = area && bg ? (opacityDraft[area.id] ?? bg.opacity) : 0.35;
  const setBackground = (id: string, background: EditorArea["background"]) => setMeta((list) => list.map((a) => (a.id === id ? { ...a, background } : a)));
  const reach = <T,>(promise: Promise<T>) => promise.catch(() => ({ ok: false as const, error: "Couldn't reach the server. Check the connection and try again." }));

  function pickImage() {
    if (!role.admin) return setToast("Only an Administrator can change the floor plan image.");
    fileRef.current?.click();
  }
  async function uploadImage(file: File) {
    if (!area) return;
    const problem = floorImageProblem(file);
    if (problem) return setToast(problem);
    const target = area;
    const form = new FormData();
    form.set("areaId", target.id);
    form.set("file", file);
    setImageBusy("upload");
    const result = await reach(uploadFloorBackground(form));
    setImageBusy("");
    if (!result.ok) return setToast(result.error);
    setBackground(target.id, result.background);
    setCalib(null);
    setTrace(true);
    setToast(result.replaced ? `Floor plan image replaced for ${target.name}` : `Floor plan uploaded for ${target.name}`);
    router.refresh();
  }
  async function removeImage() {
    if (!area || !bg) return;
    const target = area;
    setImageBusy("remove");
    const result = await reach(removeFloorBackground({ areaId: target.id }));
    setImageBusy("");
    if (!result.ok) return setToast(result.error);
    setBackground(target.id, null);
    setCalib(null);
    setToast("Floor plan image removed");
    router.refresh();
  }
  function changeOpacity(percent: number) {
    if (!area || !bg) return;
    const target = area;
    const value = Math.round(percent) / 100;
    setOpacityDraft((d) => ({ ...d, [target.id]: value }));
    if (opacityTimer.current) clearTimeout(opacityTimer.current);
    opacityTimer.current = setTimeout(async () => {
      const result = await reach(adjustFloorBackground({ areaId: target.id, opacity: value }));
      const withoutTarget = (d: Record<string, number>) => Object.fromEntries(Object.entries(d).filter(([id]) => id !== target.id));
      if (!result.ok) {
        setOpacityDraft(withoutTarget);
        return setToast(result.error);
      }
      setBackground(target.id, result.background);
      setOpacityDraft((d) => (d[target.id] === value ? withoutTarget(d) : d));
    }, 450);
  }
  function startCalibrate() {
    if (!area || !bg) return;
    setTrace(true);
    setSel(null);
    setRoomEdit(null);
    setCalib({ areaId: area.id, points: [], distance: "" });
  }
  function tapCalibrate(event: ReactPointerEvent<HTMLDivElement>) {
    event.stopPropagation();
    if (!calibHere) return;
    if (!box) return setToast("The image is still loading.");
    const r = event.currentTarget.getBoundingClientRect();
    const point = { x: round2((event.clientX - r.left) / px), y: round2((event.clientY - r.top) / px) };
    setCalib({ ...calibHere, points: calibHere.points.length >= 2 ? [point] : [...calibHere.points, point] });
  }
  async function saveCalibration() {
    if (!area || !bg || !calibHere || !nat || !box) return;
    const [a, b] = calibHere.points;
    const realM = Number(calibHere.distance.trim().replace(",", "."));
    if (!a || !b) return setToast("Tap two points on the image first.");
    if (!(realM > 0) || realM > ROOM_LIMITS_M.max * 2) return setToast("Enter the real distance between the points in metres.");
    const calibration = calibrate(box, nat, a, b, realM);
    if (!calibration) return setToast("Tap two different points on the image.");
    const target = area;
    setImageBusy("calibrate");
    const result = await reach(adjustFloorBackground({ areaId: target.id, calibration }));
    setImageBusy("");
    if (!result.ok) return setToast(result.error);
    setBackground(target.id, result.background);
    setCalib(null);
    setToast(`Scale saved · 1 m = ${Math.round(calibration.scale)} px of the image`);
  }
  async function resetCalibration() {
    if (!area || !bg?.calibration) return;
    const target = area;
    setImageBusy("calibrate");
    const result = await reach(adjustFloorBackground({ areaId: target.id, calibration: null }));
    setImageBusy("");
    if (!result.ok) return setToast(result.error);
    setBackground(target.id, result.background);
    setToast("Scale cleared · the image fits the room again");
  }

  const saveState = conflicts || blockedElsewhere ? "Can’t save" : dirtyIds.length ? "Unsaved changes" : `Saved · v${area?.layoutVersion ?? 0}`;
  const saveColor = conflicts || blockedElsewhere ? C.badRing : dirtyIds.length ? C.amber : C.green;
  const headerKey: CSSProperties = { height: 38, padding: "0 12px", border: "none", borderRadius: 4, color: C.text, fontSize: 14, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", flex: "none" };
  const conflictMsg = [overlaps.size ? `${overlaps.size} tables overlap` : "", dupHere.length ? "duplicate table number" : ""].filter(Boolean).join(" · ");
  const seats = tables.reduce((n, t) => n + t.seats, 0);

  if (!area)
    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 60, background: C.frame, color: C.text, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14 }}>
        <span style={{ fontFamily: TOUCH.display, fontSize: 22, fontWeight: 700 }}>No dining areas yet</span>
        <span style={{ color: C.dim }}>Add an area on Restaurant › Tables first.</span>
        <Link href="/restaurant/tables" style={{ color: "#9BE3D2", fontWeight: 700 }}>
          Go to Tables
        </Link>
      </div>
    );

  return (
    <div data-floor-editor style={{ position: "fixed", inset: 0, zIndex: 60, background: C.frame, color: C.text, display: "grid", gridTemplateRows: "52px minmax(0,1fr)", userSelect: "none", overflow: "hidden", lineHeight: "normal", fontFamily: "'IBM Plex Sans', system-ui, sans-serif" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 10px", background: C.panel, borderBottom: `1px solid ${C.line}`, minWidth: 0 }}>
        <Link
          href="/restaurant/tables"
          data-editor-exit
          onClick={(event) => {
            if (!dirty) return;
            event.preventDefault();
            setLeaving("/restaurant/tables");
          }}
          style={{ height: 38, display: "flex", alignItems: "center", gap: 6, padding: "0 12px", borderRadius: 4, background: C.key, color: C.text, fontSize: 14, fontWeight: 700, textDecoration: "none", flex: "none" }}>
          <ChevronLeft size={14} strokeWidth={2.4} />
          Exit
        </Link>
        <span style={{ fontFamily: TOUCH.display, fontWeight: 700, fontSize: 17, padding: "0 4px", whiteSpace: "nowrap", flex: "none" }}>Floor plan</span>
        <nav
          ref={tabsRef}
          aria-label="Areas"
          onScroll={measureTabs}
          onWheel={(event) => {
            if (tabsRef.current && event.deltaY) tabsRef.current.scrollLeft += event.deltaY;
          }}
          style={{ display: "flex", gap: 4, background: C.key, padding: 3, borderRadius: 4, minWidth: 0, overflowX: "auto", scrollbarWidth: "none", maskImage: tabMask, WebkitMaskImage: tabMask }}
        >
          {meta.map((a) => {
            const on = a.id === area.id;
            const dirty = dirtyIds.includes(a.id);
            return (
              <button
                key={a.id}
                type="button"
                data-editor-area={a.name}
                aria-current={on ? "page" : undefined}
                onClick={() => {
                  setAreaId(a.id);
                  setSel(null);
                  setRoomEdit(null);
                  setCalib(null);
                }}
                style={{ height: 32, padding: "0 10px", border: "none", borderRadius: 3, background: on ? C.teal : "transparent", color: on ? C.text : C.dim, fontSize: 14, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", flex: "none" }}
              >
                {a.name}
                {dirty ? " •" : ""}
              </button>
            );
          })}
        </nav>
        <div style={{ position: "relative", flex: "none" }}>
          <button
            type="button"
            data-room-size
            aria-expanded={!!roomEdit}
            title="Room size"
            onClick={openRoomEdit}
            style={{ height: 32, display: "flex", alignItems: "center", padding: "0 8px", border: "none", borderRadius: 3, background: roomEdit ? C.teal : C.key, color: C.text, fontFamily: TOUCH.mono, fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", cursor: "pointer" }}
          >
            {room.widthM}×{room.heightM} m
          </button>
          {roomEdit && <RoomSizePanel edit={roomEdit} onChange={(change) => setRoomEdit({ ...roomEdit, ...change, error: "" })} onApply={applyRoom} onClose={() => setRoomEdit(null)} />}
        </div>
        {activeLayout && (
          <button
            type="button"
            data-active-layout
            title="The event layout on this floor · tap to switch"
            onClick={() => openLayouts("switch")}
            style={{ height: 32, display: "flex", alignItems: "center", gap: 6, padding: "0 8px", border: "none", borderRadius: 3, background: C.amber, color: C.ink, fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", cursor: "pointer", flex: "none", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}
          >
            <span style={{ fontSize: 10, letterSpacing: ".08em", opacity: 0.75 }}>LAYOUT</span>
            {activeLayout.name}
          </button>
        )}
        <div style={{ flex: 1 }} />
        <span data-editor-role style={{ height: 32, display: "flex", alignItems: "center", gap: 6, padding: "0 8px", borderRadius: 3, background: C.key, color: "#C9D0D6", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", flex: "none" }}>
          <span aria-hidden style={{ width: 8, height: 8, borderRadius: "50%", background: role.admin ? C.green : C.amber }} />
          {role.name}
        </span>
        <button type="button" data-undo onClick={undo} disabled={!past.length} style={{ ...headerKey, background: C.key, color: past.length ? C.text : "#5A636C" }}>
          Undo
        </button>
        <button type="button" data-redo onClick={redo} disabled={!future.length} style={{ ...headerKey, padding: "0 10px", background: C.key, color: future.length ? C.text : "#5A636C" }}>
          Redo
        </button>
        <button type="button" data-snap aria-pressed={snapOn} onClick={() => setSnapOn((on) => !on)} style={{ ...headerKey, padding: "0 10px", background: snapOn ? C.teal : C.key }}>
          Snap {snapOn ? "on" : "off"}
        </button>
        <button type="button" data-trace aria-pressed={trace} onClick={() => setTrace((on) => !on)} style={{ ...headerKey, padding: "0 10px", background: trace ? C.teal : C.key }}>
          Trace image
        </button>
        <button type="button" data-lock aria-pressed={locked} onClick={() => void toggleLock()} disabled={saving} style={{ ...headerKey, padding: "0 10px", background: locked ? "#8A5A00" : C.key }}>
          {locked ? "Locked" : "Lock"}
        </button>
        <span data-save-state style={{ fontSize: 13, fontWeight: 600, color: saveColor, padding: "0 2px", whiteSpace: "nowrap", flex: "none" }}>
          {saving ? "Saving…" : saveState}
        </span>
        <button type="button" data-save onClick={() => void save()} aria-disabled={!canSave} style={{ ...headerKey, padding: "0 16px", background: canSave ? C.pay : C.idle, fontFamily: TOUCH.display, fontSize: 16, cursor: canSave ? "pointer" : "default" }}>
          SAVE
        </button>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "176px minmax(0,1fr) 290px", gap: 6, padding: 6, minHeight: 0 }}>
        <aside aria-label="Add" style={{ background: C.panel, borderRadius: 4, padding: 10, display: "flex", flexDirection: "column", gap: 8, overflowY: "auto", scrollbarWidth: "none" }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".08em", color: C.faint }}>TABLES · TAP TO ADD</span>
          {TABLE_PALETTE.map(([label, shape, seatCount, w, h]) => (
            <button
              key={label}
              type="button"
              data-palette={label}
              onClick={() => addTable(shape, seatCount, w, h)}
              style={{ height: 52, display: "flex", alignItems: "center", gap: 10, padding: "0 10px", border: "none", borderRadius: 4, background: C.key, color: C.text, fontSize: 14, fontWeight: 700, cursor: "pointer", textAlign: "left", flex: "none" }}
            >
              <span aria-hidden style={{ width: shape === "ROUND" ? 18 : shape === "SQUARE" ? 20 : shape === "BOOTH" ? 26 : 30, height: shape === "ROUND" ? 18 : shape === "SQUARE" ? 20 : shape === "BOOTH" ? 18 : 16, borderRadius: shape === "ROUND" ? "50%" : shape === "BOOTH" ? "9px 9px 2px 2px" : 3, background: C.green, opacity: 0.85, flex: "none" }} />
              {label}
            </button>
          ))}
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".08em", color: C.faint, marginTop: 6 }}>FIXTURES</span>
          {FIXTURE_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              data-palette={FIXTURE_DEFAULTS[type].label}
              onClick={() => addFixture(type)}
              style={{ height: 42, padding: "0 10px", border: "1px dashed #4A535D", borderRadius: 4, background: "transparent", color: "#C9D0D6", fontSize: 13, fontWeight: 700, cursor: "pointer", textAlign: "left", flex: "none" }}
            >
              {FIXTURE_DEFAULTS[type].label}
            </button>
          ))}
        </aside>

        <section ref={stageRef} aria-label="Room" style={{ background: C.canvas, borderRadius: 4, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, minWidth: 0, minHeight: 0, position: "relative", overflow: "hidden" }}>
          <div data-ruler style={{ display: "flex", gap: 16, fontSize: 12, color: C.faint, fontFamily: TOUCH.mono, maxWidth: "100%", whiteSpace: "nowrap", overflow: "hidden" }}>
            <span>0 m</span>
            <span>Grid {room.gridM} m</span>
            <span>Drag to move · corner to resize · arrows to nudge</span>
            <span>{room.widthM} m</span>
          </div>
          <div
            data-room
            onPointerDown={() => setSel(null)}
            style={{
              position: "relative",
              width: room.widthM * px,
              height: room.heightM * px,
              backgroundColor: C.room,
              backgroundImage: `radial-gradient(${C.dot} 1.2px, transparent 1.2px)`,
              backgroundSize: `${room.gridM * px}px ${room.gridM * px}px`,
              boxShadow: `inset 0 0 0 2px ${C.roomEdge}`,
              borderRadius: 2,
              touchAction: "none",
              flexShrink: 0,
            }}
          >
            {trace && bg && (
              <div data-trace-image style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none", borderRadius: 2 }}>
                {/* eslint-disable-next-line @next/next/no-img-element -- a private, already re-encoded image laid out in metres; next/image adds nothing here */}
                <img
                  src={bg.url}
                  alt=""
                  draggable={false}
                  onLoad={(event) => {
                    const { naturalWidth: w, naturalHeight: h } = event.currentTarget;
                    if (w && h) setNatural((n) => (n[bg.url] ? n : { ...n, [bg.url]: { w, h } }));
                  }}
                  style={box ? { position: "absolute", left: box.x * px, top: box.y * px, width: box.w * px, height: box.h * px, maxWidth: "none", opacity } : { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", opacity }}
                />
              </div>
            )}
            {trace && !bg && (
              <div data-trace-empty style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "repeating-linear-gradient(45deg,rgba(242,178,51,.06) 0 14px,transparent 14px 28px)", color: "#8A7A50", fontSize: 14, fontWeight: 600, pointerEvents: "none", textAlign: "center", padding: 20 }}>
                {role.admin ? `No floor plan uploaded for ${area.name} · use Upload floor plan on the right` : "No floor plan uploaded · ask an Administrator"}
              </div>
            )}
            {calibHere && (
              <div data-calibrate-layer onPointerDown={tapCalibrate} style={{ position: "absolute", inset: 0, zIndex: 6, cursor: "crosshair", touchAction: "none", background: "rgba(15,125,106,.06)" }}>
                <svg width="100%" height="100%" style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "visible" }}>
                  {calibHere.points.length === 2 && (
                    <line x1={calibHere.points[0].x * px} y1={calibHere.points[0].y * px} x2={calibHere.points[1].x * px} y2={calibHere.points[1].y * px} stroke={C.amber} strokeWidth={3} strokeDasharray="8 5" />
                  )}
                  {calibHere.points.map((point, index) => (
                    <g key={index} data-calibrate-point>
                      <circle cx={point.x * px} cy={point.y * px} r={9} fill="none" stroke="#fff" strokeWidth={3} />
                      <circle cx={point.x * px} cy={point.y * px} r={3} fill={C.amber} />
                    </g>
                  ))}
                </svg>
              </div>
            )}
            {items.map((item) => {
              const isSel = item.key === sel;
              const isTable = item.kind === "table";
              const bad = isTable && (overlaps.has(item.key) || dupes.has(item.key));
              const wide = item.w * px >= 64;
              return (
                <div
                  key={item.key}
                  data-floor-item={itemName(item)}
                  data-kind={item.kind}
                  data-bad={bad || undefined}
                  aria-selected={isSel}
                  onPointerDown={(event) => startDrag(event, item, "move")}
                  style={{
                    position: "absolute",
                    left: item.x * px,
                    top: item.y * px,
                    width: item.w * px,
                    height: item.h * px,
                    transform: `rotate(${item.rotation}deg)`,
                    borderRadius: isTable ? (item.shape === "ROUND" ? "50%" : item.shape === "BOOTH" ? "18px 18px 4px 4px" : 6) : 3,
                    background: isTable ? (bad ? C.bad : C.key) : "rgba(255,255,255,.03)",
                    border: isTable ? "none" : "1.5px dashed #5A636C",
                    boxShadow: isSel ? `0 0 0 3px ${C.teal}, 0 0 0 5px #fff` : bad ? `inset 0 0 0 2px ${C.badRing}` : isTable ? `inset 0 0 0 2px ${C.green}` : "none",
                    color: isTable ? C.text : "#7D8790",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 1,
                    cursor: locked ? "default" : "grab",
                    touchAction: "none",
                    zIndex: isTable ? 2 : 1,
                  }}
                >
                  <span style={{ fontFamily: TOUCH.display, fontSize: isTable ? (wide ? 22 : 15) : 11, fontWeight: 700, lineHeight: 1, pointerEvents: "none", letterSpacing: isTable ? 0 : ".1em", textAlign: "center", overflowWrap: "anywhere" }}>
                    {isTable ? item.name : item.label.toUpperCase()}
                  </span>
                  {isTable && wide && <span style={{ fontSize: 11, fontWeight: 700, opacity: 0.85, pointerEvents: "none" }}>{item.seats} seats</span>}
                  {isSel && !locked && (
                    <span
                      data-resize
                      onPointerDown={(event) => startDrag(event, item, "resize")}
                      style={{ position: "absolute", right: -9, bottom: -9, width: 18, height: 18, borderRadius: 3, background: "#fff", boxShadow: `0 0 0 2px ${C.teal}`, cursor: "nwse-resize", touchAction: "none" }}
                    />
                  )}
                </div>
              );
            })}
          </div>
          <span data-conflict style={{ minHeight: 18, fontSize: 14, fontWeight: 700, color: C.badRing }}>
            {conflicts ? `${conflictMsg} · fix before saving` : blockedElsewhere ? "Another area has red tables · fix before saving" : ""}
          </span>
          {calibHere && (
            <div data-calibrate-hint style={{ position: "absolute", left: "50%", top: 10, transform: "translateX(-50%)", background: C.amber, color: C.ink, padding: "8px 14px", borderRadius: 4, fontSize: 14, fontWeight: 700, whiteSpace: "nowrap", zIndex: 5 }}>
              {calibHere.points.length === 0 ? "Calibrate · tap the first point on the image" : calibHere.points.length === 1 ? "Calibrate · tap the second point" : "Enter the real distance on the right · or tap again to start over"}
            </div>
          )}
          {toast && (
            <div data-editor-toast role="status" style={{ position: "absolute", left: "50%", bottom: conflicts || blockedElsewhere ? 44 : 14, transform: "translateX(-50%)", background: "#fff", color: C.ink, padding: "12px 18px", borderRadius: 4, fontSize: 15, fontWeight: 600, boxShadow: "0 8px 24px rgba(0,0,0,.4)", width: "max-content", maxWidth: "calc(100% - 24px)", textAlign: "center", lineHeight: 1.4, zIndex: 5 }}>
              {toast}
            </div>
          )}
        </section>

        <aside aria-label="Inspector" style={{ background: "#fff", color: C.ink, borderRadius: 4, display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
          {selected ? (
            <Inspector
              item={selected}
              locked={locked}
              duplicateNumber={dupes.has(selected.key)}
              onRename={(value) => update(selected.key, (i) => (i.kind === "table" ? { ...i, name: value } : { ...i, label: value }), false)}
              onSeats={(by) => update(selected.key, (i) => (i.kind === "table" ? { ...i, seats: clamp(i.seats + by, 1, MAX_SEATS) } : i))}
              onShape={(shape) =>
                update(selected.key, (i) => {
                  if (i.kind !== "table") return i;
                  const [w, h] = SHAPE_SIZE[shape];
                  return fit({ ...i, shape, w: Math.min(w, room.widthM), h: Math.min(h, room.heightM) });
                })
              }
              onRotate={(by) => update(selected.key, (i) => fit({ ...i, rotation: (((i.rotation + by) % 360) + 360) % 360 }))}
              onDuplicate={duplicate}
              onDelete={remove}
              guard={guard}
            />
          ) : (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 14, padding: 18, overflowY: "auto", scrollbarWidth: "none" }}>
              <span style={{ fontFamily: TOUCH.display, fontSize: 20, fontWeight: 700 }}>{area.name}</span>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 8 }}>
                {[
                  [String(tables.length), "Tables"],
                  [String(seats), "Seats"],
                  [String(items.length - tables.length), "Fixtures"],
                  [`v${area.layoutVersion}`, "Layout version"],
                ].map(([value, label]) => (
                  <div key={label} data-area-stat={label} style={{ background: C.strip, borderRadius: 4, padding: 12, display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={{ fontFamily: TOUCH.display, fontSize: 24, fontWeight: 700 }}>{value}</span>
                    <span style={{ fontSize: 13, color: C.inkDim }}>{label}</span>
                  </div>
                ))}
              </div>
              <ImageCard
                areaName={area.name}
                background={bg}
                admin={role.admin}
                busy={imageBusy}
                opacity={opacity}
                calibrating={calibHere}
                onPick={pickImage}
                onRemove={removeImage}
                onOpacity={changeOpacity}
                onCalibrate={startCalibrate}
                onResetCalibration={resetCalibration}
                onDistance={(distance) => calibHere && setCalib({ ...calibHere, distance })}
                onSaveCalibration={saveCalibration}
                onCancelCalibration={() => setCalib(null)}
              />
              <input
                ref={fileRef}
                type="file"
                data-image-file
                accept={FLOOR_IMAGE_ACCEPT}
                style={{ display: "none" }}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void uploadImage(file);
                }}
              />
              <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 14, color: C.inkDim, lineHeight: 1.45 }}>
                <span style={{ fontWeight: 700, color: C.ink }}>How to match your room</span>
                <span>1. Set the room size in metres.</span>
                <span>2. Turn on Trace image and upload a photo of your sketch.</span>
                <span>3. Add tables from the left and drag them into place.</span>
                <span>4. Add the bar, pass and entrance so staff can orient.</span>
                <span>5. Save. Every tablet updates straight away.</span>
              </div>
              <div style={{ flex: 1 }} />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 6 }}>
                {(
                  [
                    ["Save as layout…", "save"],
                    ["Switch layout", "switch"],
                  ] as const
                ).map(([label, which]) => (
                  <button key={label} type="button" data-layouts={which} onClick={() => openLayouts(which)} style={{ height: 48, border: "none", borderRadius: 4, background: C.key, color: C.text, fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </aside>
      </div>

      {leaving && (
        <Dialog
          title="Save your changes?"
          body={
            <>
              You&apos;ve changed {dirtyIds.map((id) => meta.find((a) => a.id === id)?.name).filter(Boolean).join(", ")} and haven&apos;t saved.
              {conflicts || blockedElsewhere ? <span style={{ display: "block", marginTop: 8, color: C.badText, fontWeight: 600 }}>Some tables are red, so it can&apos;t be saved as it is.</span> : null}
            </>
          }
          dataName="leave"
          onClose={() => setLeaving(null)}
          actions={[
            { label: "Cancel", onClick: () => setLeaving(null) },
            {
              label: "Discard",
              tone: "bad",
              onClick: () => {
                const to = leaving;
                setPlans(saved);
                setLeaving(null);
                router.push(to);
              },
            },
            { label: saving ? "Saving…" : "Save", tone: "go", disabled: saving || !!conflicts || blockedElsewhere, onClick: () => void saveAndLeave() },
          ]}
        />
      )}
      {layoutDialog === "save" && (
        <Dialog
          title="Save as layout"
          dataName="layout-save"
          onClose={() => setLayoutDialog(null)}
          body={
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <span>
                Keeps {area.name} as it&apos;s saved now ({tables.length} tables · {seats} seats) under a name, for an event. It goes on the floor when you pick it in Switch layout.
              </span>
              <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, fontWeight: 700, color: C.inkDim }}>
                Layout name
                <input
                  data-layout-name
                  autoFocus
                  maxLength={LAYOUT_NAME_MAX}
                  placeholder="Wedding setup"
                  value={layoutName}
                  onChange={(event) => {
                    setLayoutName(event.target.value);
                    setLayoutExists(false);
                    setLayoutError("");
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void saveLayout(layoutExists);
                  }}
                  style={{ height: 46, border: `1px solid ${C.edge}`, borderRadius: 4, padding: "0 12px", fontSize: 17, fontWeight: 700, color: C.ink, background: "#fff", userSelect: "text" }}
                />
              </label>
              {layoutExists && (
                <span data-layout-exists style={{ color: "#8A5A00", fontWeight: 600 }}>
                  There&apos;s already a layout called “{layoutName.trim()}”. Replace it with this floor?
                </span>
              )}
              {layoutError && (
                <span data-layout-error role="alert" style={{ color: C.badText, fontWeight: 600 }}>
                  {layoutError}
                </span>
              )}
            </div>
          }
          actions={[
            { label: "Cancel", onClick: () => setLayoutDialog(null) },
            { label: layoutBusy ? "Saving…" : layoutExists ? "Replace" : "Save layout", tone: "go", disabled: layoutBusy || !layoutName.trim(), onClick: () => void saveLayout(layoutExists) },
          ]}
        />
      )}
      {layoutDialog === "switch" && (
        <Dialog
          title={`Layouts · ${area.name}`}
          dataName="layout-switch"
          width={540}
          onClose={() => setLayoutDialog(null)}
          body={
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ marginBottom: 4 }}>Puts a saved layout on the floor — every tablet follows. Not while a table it takes away has an open order or a booking today.</span>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 330, overflowY: "auto" }}>
                <LayoutRow
                  name={NORMAL_NAME}
                  detail={activeLayout ? (area.hasNormal ? "The everyday floor, kept while an event layout is on" : "Not kept — pick the layout you want instead") : "The everyday floor"}
                  showing={!activeLayout}
                  action={activeLayout && area.hasNormal ? { label: "Restore normal", data: "restore", onClick: () => void switchTo(null) } : null}
                  busy={layoutBusy}
                />
                {area.layouts.map((layout) => (
                  <LayoutRow
                    key={layout.id}
                    name={layout.name}
                    detail={`${layout.summary} · saved ${layout.saved}`}
                    showing={layout.isActive}
                    action={layout.isActive ? null : { label: "Use", data: "use", onClick: () => void switchTo(layout.id) }}
                    remove={layout.isActive ? null : { label: confirmDelete === layout.id ? "Sure?" : "Delete", onClick: () => void removeLayout(layout.id) }}
                    busy={layoutBusy}
                  />
                ))}
                {area.layouts.length === 0 && <span style={{ padding: "8px 2px" }}>No saved layouts for {area.name} yet. Use Save as layout… to keep one.</span>}
              </div>
              {layoutError && (
                <span data-layout-error role="alert" style={{ color: C.badText, fontWeight: 600, marginTop: 4 }}>
                  {layoutError}
                </span>
              )}
            </div>
          }
          actions={[{ label: layoutBusy ? "Working…" : "Close", onClick: () => setLayoutDialog(null), disabled: layoutBusy }]}
        />
      )}
      {stale && (
        <Dialog
          title={stale.message}
          body={<>Someone saved {meta.find((a) => a.id === stale.areaId)?.name ?? "this area"} after you opened it. Reload it to see their layout — your unsaved changes to it will be lost.</>}
          dataName="stale"
          onClose={() => setStale(null)}
          actions={[
            { label: "Not now", onClick: () => setStale(null) },
            { label: "Reload", tone: "go", onClick: () => reloadArea(stale.areaId) },
          ]}
        />
      )}
    </div>
  );
}

// One line of the Switch layout list: its name, what's in it, and Use (or
// "On the floor").
function LayoutRow({
  name,
  detail,
  showing,
  action,
  remove,
  busy,
}: {
  name: string;
  detail: string;
  showing: boolean;
  action: { label: string; data: string; onClick: () => void } | null;
  remove?: { label: string; onClick: () => void } | null;
  busy: boolean;
}) {
  const small: CSSProperties = { height: 38, padding: "0 12px", border: "none", borderRadius: 4, fontSize: 13, fontWeight: 700, cursor: busy ? "default" : "pointer", flex: "none", opacity: busy ? 0.6 : 1 };
  return (
    <div data-layout-row={name} style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", background: C.strip, borderRadius: 4 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, color: C.ink, overflowWrap: "anywhere" }}>{name}</div>
        <div style={{ fontSize: 12.5, lineHeight: 1.35 }}>{detail}</div>
      </div>
      {showing && (
        <span data-layout-showing style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", color: "#0A6355", background: "#DDF3EC", padding: "5px 8px", borderRadius: 3, flex: "none" }}>
          ON THE FLOOR
        </span>
      )}
      {action && (
        <button type="button" data-layout-action={action.data} disabled={busy} onClick={action.onClick} style={{ ...small, background: C.teal, color: "#fff" }}>
          {action.label}
        </button>
      )}
      {remove && (
        <button type="button" data-layout-delete disabled={busy} onClick={remove.onClick} style={{ ...small, background: "#fff", color: C.badText, boxShadow: "inset 0 0 0 1px #E3B7B9" }}>
          {remove.label}
        </button>
      )}
    </div>
  );
}

// A question in the middle of the editor (leave unsaved, a stale save).
function Dialog({
  title,
  body,
  actions,
  onClose,
  dataName,
  width = 420,
}: {
  title: string;
  width?: number;
  body: ReactNode;
  actions: { label: string; onClick: () => void; tone?: "go" | "bad"; disabled?: boolean }[];
  onClose: () => void;
  dataName: string;
}) {
  return (
    <div
      data-dialog={dataName}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
      style={{ position: "absolute", inset: 0, zIndex: 40, background: "rgba(10,12,14,.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
    >
      <div style={{ width, maxWidth: "100%", background: "#fff", color: C.ink, borderRadius: 4, padding: 20, display: "flex", flexDirection: "column", gap: 12, boxShadow: "0 16px 40px rgba(0,0,0,.5)" }}>
        <span data-dialog-title style={{ fontFamily: TOUCH.display, fontSize: 20, fontWeight: 700 }}>
          {title}
        </span>
        <div style={{ fontSize: 14, color: C.inkDim, lineHeight: 1.5 }}>{body}</div>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${actions.length}, minmax(0,1fr))`, gap: 6, marginTop: 4 }}>
          {actions.map((action, index) => (
            <button
              key={action.label}
              type="button"
              data-dialog-action={action.label.replace("…", "")}
              autoFocus={index === actions.length - 1}
              disabled={action.disabled}
              onClick={action.onClick}
              style={{
                height: 48,
                border: "none",
                borderRadius: 4,
                background: action.tone === "go" ? C.pay : action.tone === "bad" ? C.void : C.strip,
                color: action.tone ? "#fff" : C.ink,
                fontSize: 15,
                fontWeight: 700,
                cursor: action.disabled ? "default" : "pointer",
                opacity: action.disabled ? 0.5 : 1,
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// The right panel with a table or fixture picked: its number (or label),
// seats and shape (tables), size and place in metres, rotation, Duplicate,
// Delete.
function Inspector({
  item,
  locked,
  duplicateNumber,
  onRename,
  onSeats,
  onShape,
  onRotate,
  onDuplicate,
  onDelete,
  guard,
}: {
  item: Item;
  locked: boolean;
  duplicateNumber: boolean;
  onRename: (value: string) => void;
  onSeats: (by: 1 | -1) => void;
  onShape: (shape: TableShape) => void;
  onRotate: (by: 45 | -45) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  guard: () => boolean;
}) {
  const isTable = item.kind === "table";
  const dark: CSSProperties = { border: "none", borderRadius: 4, background: C.key, color: C.text, fontWeight: 700, cursor: locked ? "default" : "pointer", opacity: locked ? 0.45 : 1 };
  const cell: CSSProperties = { height: 44, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 12px", background: C.strip, borderRadius: 4 };
  const act = (run: () => void) => () => {
    if (!guard()) run();
  };
  return (
    <div data-inspector style={{ flex: 1, display: "flex", flexDirection: "column", gap: 14, padding: 16, overflowY: "auto", scrollbarWidth: "none" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontFamily: TOUCH.display, fontSize: 22, fontWeight: 700, overflowWrap: "anywhere" }}>{isTable ? `Table ${item.name}` : item.label}</span>
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".06em", color: C.faint }}>{isTable ? item.shape : "FIXTURE"}</span>
      </div>
      <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, fontWeight: 700, color: C.inkDim }}>
        {isTable ? "Table number" : "Label"}
        <input
          data-inspector-name
          value={isTable ? item.name : item.label}
          disabled={locked}
          maxLength={isTable ? 20 : 40}
          onChange={(event) => onRename(event.target.value)}
          style={{ height: 48, border: `1px solid ${C.edge}`, borderRadius: 4, padding: "0 12px", fontSize: 18, fontWeight: 700, color: C.ink, background: duplicateNumber ? "#FDECEC" : "#fff", userSelect: "text" }}
        />
        {duplicateNumber && <span style={{ color: C.badText, fontWeight: 600 }}>{isTable && !item.name.trim() ? "A table needs a number" : "Number already used"}</span>}
      </label>
      {isTable && (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: C.inkDim }}>Seats</span>
            <div style={{ display: "grid", gridTemplateColumns: "52px minmax(0,1fr) 52px", gap: 4 }}>
              <button type="button" data-seats-down aria-label="One seat fewer" onClick={act(() => onSeats(-1))} style={{ ...dark, height: 48, fontSize: 22 }}>
                −
              </button>
              <div data-seats style={{ height: 48, display: "flex", alignItems: "center", justifyContent: "center", background: C.strip, borderRadius: 4, fontFamily: TOUCH.display, fontSize: 22, fontWeight: 700 }}>
                {item.seats}
              </div>
              <button type="button" data-seats-up aria-label="One seat more" onClick={act(() => onSeats(1))} style={{ ...dark, height: 48, fontSize: 22 }}>
                +
              </button>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: C.inkDim }}>Shape</span>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 4 }}>
              {SHAPES.map((shape) => {
                const on = item.shape === shape;
                return (
                  <button key={shape} type="button" data-shape={shape} aria-pressed={on} onClick={act(() => onShape(shape))} style={{ height: 44, border: "none", borderRadius: 4, background: on ? C.teal : C.strip, color: on ? "#fff" : C.ink, fontSize: 12, fontWeight: 700, cursor: locked ? "default" : "pointer" }}>
                    {shape[0] + shape.slice(1).toLowerCase()}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.inkDim }}>Size</span>
        <div data-geometry style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 6, fontFamily: TOUCH.mono, fontSize: 15, fontWeight: 600 }}>
          {(
            [
              ["W", item.w],
              ["H", item.h],
              ["X", item.x],
              ["Y", item.y],
            ] as const
          ).map(([label, value]) => (
            <div key={label} style={cell}>
              <span style={{ color: C.faint }}>{label}</span>
              {m(value)}
            </div>
          ))}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.inkDim }}>Rotation · {item.rotation}°</span>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 4 }}>
          <button type="button" data-rotate="-45" onClick={act(() => onRotate(-45))} style={{ ...dark, height: 44, fontSize: 14 }}>
            ⟲ 45°
          </button>
          <button type="button" data-rotate="45" onClick={act(() => onRotate(45))} style={{ ...dark, height: 44, fontSize: 14 }}>
            45° ⟳
          </button>
        </div>
      </div>
      <div style={{ flex: 1 }} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 6 }}>
        <button type="button" data-duplicate onClick={onDuplicate} style={{ ...dark, height: 52, fontSize: 15 }}>
          Duplicate
        </button>
        <button type="button" data-delete onClick={onDelete} style={{ ...dark, height: 52, fontSize: 15, background: C.void }}>
          Delete
        </button>
      </div>
    </div>
  );
}

// The room size panel under the header's "12×8 m": width and depth in
// metres, and the dot grid.
function RoomSizePanel({
  edit,
  onChange,
  onApply,
  onClose,
}: {
  edit: { w: string; h: string; grid: number; error: string };
  onChange: (change: Partial<{ w: string; h: string; grid: number }>) => void;
  onApply: () => void;
  onClose: () => void;
}) {
  const field: CSSProperties = { height: 44, border: `1px solid ${C.edge}`, borderRadius: 4, padding: "0 10px", fontFamily: TOUCH.mono, fontSize: 17, fontWeight: 600, color: C.ink, background: "#fff", width: "100%", userSelect: "text" };
  const label: CSSProperties = { display: "flex", flexDirection: "column", gap: 6, fontSize: 13, fontWeight: 700, color: C.inkDim };
  return (
    <>
      <div aria-hidden onPointerDown={onClose} style={{ position: "fixed", inset: 0, zIndex: 19 }} />
      <form
        data-room-panel
        onSubmit={(event) => {
          event.preventDefault();
          onApply();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
        style={{ position: "absolute", top: 40, left: 0, zIndex: 20, width: 280, background: "#fff", color: C.ink, borderRadius: 4, padding: 14, display: "flex", flexDirection: "column", gap: 12, boxShadow: "0 12px 32px rgba(0,0,0,.45)" }}
      >
        <span style={{ fontFamily: TOUCH.display, fontSize: 18, fontWeight: 700 }}>Room size</span>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 8 }}>
          <label style={label}>
            Width (m)
            <input data-room-width inputMode="decimal" autoFocus value={edit.w} onChange={(event) => onChange({ w: event.target.value })} style={field} />
          </label>
          <label style={label}>
            Depth (m)
            <input data-room-depth inputMode="decimal" value={edit.h} onChange={(event) => onChange({ h: event.target.value })} style={field} />
          </label>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: C.inkDim }}>Grid</span>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${GRID_SIZES_M.length}, minmax(0,1fr))`, gap: 4 }}>
            {GRID_SIZES_M.map((grid) => {
              const on = edit.grid === grid;
              return (
                <button key={grid} type="button" data-room-grid={grid} aria-pressed={on} onClick={() => onChange({ grid })} style={{ height: 40, border: "none", borderRadius: 4, background: on ? C.teal : C.strip, color: on ? "#fff" : C.ink, fontFamily: TOUCH.mono, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
                  {grid} m
                </button>
              );
            })}
          </div>
        </div>
        {edit.error && (
          <span data-room-error role="alert" style={{ fontSize: 13, fontWeight: 600, color: C.badText, lineHeight: 1.4 }}>
            {edit.error}
          </span>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 6 }}>
          <button type="button" onClick={onClose} style={{ height: 44, border: "none", borderRadius: 4, background: C.strip, color: C.ink, fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
            Cancel
          </button>
          <button type="submit" data-room-apply style={{ height: 44, border: "none", borderRadius: 4, background: C.teal, color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
            Apply
          </button>
        </div>
      </form>
    </>
  );
}

// "Floor plan image · ADMIN ONLY" (the design's card): upload or replace,
// remove, fade, and calibrate the scale. Managers see what's there and who
// can change it.
function ImageCard({
  areaName,
  background,
  admin,
  busy,
  opacity,
  calibrating,
  onPick,
  onRemove,
  onOpacity,
  onCalibrate,
  onResetCalibration,
  onDistance,
  onSaveCalibration,
  onCancelCalibration,
}: {
  areaName: string;
  background: EditorArea["background"];
  admin: boolean;
  busy: "" | "upload" | "remove" | "calibrate";
  opacity: number;
  calibrating: { points: Point[]; distance: string } | null;
  onPick: () => void;
  onRemove: () => void;
  onOpacity: (percent: number) => void;
  onCalibrate: () => void;
  onResetCalibration: () => void;
  onDistance: (value: string) => void;
  onSaveCalibration: () => void;
  onCancelCalibration: () => void;
}) {
  const percent = Math.round(opacity * 100);
  const light: CSSProperties = { height: 40, border: "none", borderRadius: 4, background: "#fff", color: C.ink, fontSize: 13, fontWeight: 700, cursor: "pointer", boxShadow: `inset 0 0 0 1px ${C.edge}` };
  const canSaveScale = busy === "" && !!calibrating && calibrating.points.length === 2 && !!calibrating.distance.trim();
  return (
    <div data-image-card style={{ display: "flex", flexDirection: "column", gap: 8, padding: 12, borderRadius: 4, background: C.strip }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontSize: 14, fontWeight: 700 }}>Floor plan image</span>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", color: C.faint }}>ADMIN ONLY</span>
      </div>
      <span data-image-status style={{ fontSize: 13, color: C.inkDim, lineHeight: 1.4, overflowWrap: "anywhere" }}>
        {background ? `${background.name} · shown faded behind the grid while editing. Never shown to waiters.` : `Upload a photo or drawing of the ${areaName} plan, then drag tables on top of it.`}
      </span>
      {!admin ? (
        <span data-image-admin-only style={{ fontSize: 13, fontWeight: 600, color: "#8A5A00" }}>
          Only an Administrator can upload or change the floor plan image.
        </span>
      ) : calibrating ? (
        <div data-calibrate-panel style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={{ fontSize: 13, color: C.inkDim, lineHeight: 1.4 }}>Tap two points on the image whose real distance you know, such as both ends of a wall.</span>
          <span data-calibrate-count style={{ fontSize: 13, fontWeight: 700 }}>Points tapped · {calibrating.points.length} of 2</span>
          <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, fontWeight: 700, color: C.inkDim }}>
            Real distance between them (m)
            <input
              data-calibrate-distance
              inputMode="decimal"
              value={calibrating.distance}
              onChange={(event) => onDistance(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") onSaveCalibration();
              }}
              style={{ height: 44, border: `1px solid ${C.edge}`, borderRadius: 4, padding: "0 10px", fontFamily: TOUCH.mono, fontSize: 17, fontWeight: 600, color: C.ink, background: "#fff", userSelect: "text" }}
            />
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 6 }}>
            <button type="button" onClick={onCancelCalibration} style={light}>
              Cancel
            </button>
            <button type="button" data-calibrate-save disabled={!canSaveScale} onClick={onSaveCalibration} style={{ ...light, background: C.teal, color: "#fff", boxShadow: "none", opacity: canSaveScale ? 1 : 0.5, cursor: canSaveScale ? "pointer" : "default" }}>
              {busy === "calibrate" ? "Saving…" : "Save scale"}
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "grid", gridTemplateColumns: background ? "minmax(0,1fr) 96px" : "minmax(0,1fr)", gap: 6 }}>
            <button type="button" data-image-upload disabled={busy !== ""} onClick={onPick} style={{ height: 44, border: "none", borderRadius: 4, background: C.teal, color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", opacity: busy && busy !== "upload" ? 0.6 : 1 }}>
              {busy === "upload" ? "Uploading…" : background ? "Replace image" : "Upload floor plan"}
            </button>
            {background && (
              <button type="button" data-image-remove disabled={busy !== ""} onClick={onRemove} style={{ height: 44, border: "none", borderRadius: 4, background: "#fff", color: C.badText, fontSize: 14, fontWeight: 700, cursor: "pointer", boxShadow: "inset 0 0 0 1px #E3B7B9" }}>
                {busy === "remove" ? "…" : "Remove"}
              </button>
            )}
          </div>
          {background && (
            <>
              <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, fontWeight: 600, color: C.inkDim }}>
                Opacity
                <input type="range" data-image-opacity min={OPACITY_LIMITS.min * 100} max={OPACITY_LIMITS.max * 100} value={percent} onChange={(event) => onOpacity(Number(event.target.value))} style={{ flex: 1, accentColor: C.teal }} />
                <span style={{ fontFamily: TOUCH.mono, width: 38, textAlign: "right" }}>{percent}%</span>
              </label>
              <div style={{ display: "grid", gridTemplateColumns: background.calibration ? "minmax(0,1fr) 72px" : "minmax(0,1fr)", gap: 6 }}>
                <button type="button" data-image-calibrate disabled={busy !== ""} onClick={onCalibrate} style={light}>
                  {background.calibration ? `Scale · 1 m = ${Math.round(background.calibration.scale)} px` : "Calibrate scale"}
                </button>
                {background.calibration && (
                  <button type="button" data-image-uncalibrate disabled={busy !== ""} onClick={onResetCalibration} style={{ ...light, color: C.inkDim }}>
                    Reset
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
