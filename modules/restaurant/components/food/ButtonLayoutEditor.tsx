"use client";

import { Fragment, useMemo, useState, useTransition, type DragEvent, type ReactNode } from "react";
import toast from "react-hot-toast";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, CornerUpLeft, House, Pencil, Plus, Wand2 } from "lucide-react";
import { COLORS } from "@/components/layout/theme";
import { DEPARTMENT_LABEL, DEPARTMENT_SHADES, DEPARTMENTS, GRID_SLOTS, type Department } from "../../lib/posGrid";
import { buildPosMenu, groupPath, type MenuGroupRow, type PosCell } from "../../lib/posMenu";
import { TOUCH } from "../../lib/theme";
import { MAX_GRID_CELL } from "../../schemas/menuGroup";
import { groupsFromCategories, moveMenuGroupRank, placeMenuButton, unplaceDish } from "../../server/actions/menuGroups";
import type { ButtonEditorData } from "../../server/queries/menuGroups";
import MenuGroupModal, { type GroupModalState } from "./MenuGroupModal";

type Picked = { kind: "group" | "item"; id: string; name: string; fromTray: boolean };

const small = (active = false) =>
  ({
    width: 26,
    height: 26,
    border: `1px solid ${COLORS.borderStrong}`,
    borderRadius: 6,
    background: active ? COLORS.tealTint : "#fff",
    color: COLORS.slate,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    padding: 0,
    flexShrink: 0,
  }) as const;

function Panel({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section style={{ background: "#fff", border: `1px solid ${COLORS.border}`, borderRadius: 12, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
      <header style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px", borderBottom: `1px solid ${COLORS.border}` }}>
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600, flex: 1 }}>{title}</h2>
        {actions}
      </header>
      {children}
    </section>
  );
}

// Food › POS buttons: the touch POS's button layout. Pick Food or Bar; the
// group tree on the left (order with ▲ ▼, edit, add sub-groups); the grid in
// the middle exactly as the POS shows it — drag a button onto another cell
// to move it (the two swap), or tap a button then tap where it goes; dishes
// not placed yet on the right, to drag (or tap) into a group. Every change
// saves at once and shows on the POS.
export default function ButtonLayoutEditor({ data }: { data: ButtonEditorData }) {
  const tree = useMemo(() => buildPosMenu(data.groups, data.dishes), [data.groups, data.dishes]);
  const dishes = useMemo(() => new Map(data.dishes.map((d) => [d.id, d])), [data.dishes]);
  const rows = useMemo(() => new Map(data.groups.map((g) => [g.id, g])), [data.groups]);
  const [department, setDepartment] = useState<Department>("FOOD");
  const [levelId, setLevelId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [dragging, setDragging] = useState<Picked | null>(null);
  const [overCell, setOverCell] = useState<number | null>(null);
  const [modal, setModal] = useState<GroupModalState | null>(null);
  const [query, setQuery] = useState("");
  const [isPending, startTransition] = useTransition();

  // A level that's gone (deleted, moved to the other side): back home.
  const level = levelId && rows.has(levelId) && tree.groups[levelId]?.department === department ? levelId : null;
  const cells: PosCell[] = level ? tree.grids[level] : tree.home[department];
  const lastUsed = cells.reduce((last, cell, i) => (cell ? i : last), -1);
  // One empty page past the last used one, to place buttons on a new page.
  const pages = Math.min(Math.floor(lastUsed / GRID_SLOTS) + 2, Math.ceil((MAX_GRID_CELL + 1) / GRID_SLOTS));
  const shownPage = Math.min(page, pages - 1);
  const path = groupPath(tree, level);
  const notPlaced = data.dishes.filter((d) => tree.groups[tree.dishGroup[d.id]]?.auto);
  const needle = query.trim().toLowerCase();
  const tray = notPlaced.filter((d) => tree.dishDepartment[d.id] === department && (!needle || d.name.toLowerCase().includes(needle)));

  function run(work: () => Promise<{ ok: boolean; error?: string }>, done?: string) {
    startTransition(async () => {
      const result = await work();
      if (!result.ok) toast.error(result.error ?? "Something went wrong. Please try again.");
      else if (done) toast.success(done);
    });
  }

  function open(id: string | null) {
    setLevelId(id);
    setPage(0);
  }

  function dropOn(cell: number, button: Picked) {
    setPicked(null);
    if (button.kind === "item" && !level) return void toast.error("Dishes go inside a group. Open a group first.");
    if (button.kind === "group") {
      const inLevel = cells.some((c) => c?.kind === "group" && c.id === button.id);
      if (!inLevel) return void toast.error("To move a group into another group, use its ✎ Edit (Inside).");
    }
    run(() => placeMenuButton({ kind: button.kind, id: button.id, department, groupId: level, cell }));
  }

  function takeOff(button: Picked) {
    setPicked(null);
    if (button.kind !== "item" || button.fromTray) return;
    run(() => unplaceDish(button.id), `${button.name} is back in Not placed.`);
  }

  const dragProps = (button: Picked) => ({
    draggable: true,
    onDragStart: (event: DragEvent) => {
      event.dataTransfer.setData("text/plain", button.id);
      event.dataTransfer.effectAllowed = "move";
      setDragging(button);
    },
    onDragEnd: () => {
      setDragging(null);
      setOverCell(null);
    },
  });

  function cellView(cell: PosCell, index: number) {
    const group = cell?.kind === "group" ? tree.groups[cell.id] : null;
    const dish = cell?.kind === "item" ? dishes.get(cell.id) : null;
    const auto = !!group?.auto;
    const button: Picked | null = group && !auto ? { kind: "group", id: group.id, name: group.name, fromTray: false } : dish ? { kind: "item", id: dish.id, name: dish.name, fromTray: false } : null;
    const isPicked = !!button && picked?.kind === button.kind && picked.id === button.id;
    const colour = group ? group.colour : dish ? tree.groups[tree.dishGroup[dish.id]]?.colour : null;
    const target = overCell === index && dragging;

    return (
      <div
        key={index}
        data-cell={index}
        data-cell-button={group?.name ?? dish?.name ?? undefined}
        onDragOver={(event) => {
          if (!dragging) return;
          event.preventDefault();
          if (overCell !== index) setOverCell(index);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setOverCell(null);
          if (dragging) dropOn(index, dragging);
          setDragging(null);
        }}
        onClick={() => {
          if (picked && !isPicked) return dropOn(index, picked);
          if (button && !auto) setPicked(isPicked ? null : button);
        }}
        onDoubleClick={() => group && !auto && open(group.id)}
        {...(button ? dragProps(button) : {})}
        title={auto ? "Not placed yet — these dishes show under their category until you place them." : undefined}
        style={{
          position: "relative",
          borderRadius: TOUCH.radius,
          background: colour && !auto ? colour : auto ? "transparent" : TOUCH.raised,
          border: auto ? `2px dashed ${colour}` : "2px solid transparent",
          outline: isPicked ? "3px solid #fff" : target ? `3px solid ${COLORS.tealBorder}` : "none",
          outlineOffset: -3,
          color: "#fff",
          padding: "4px 7px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: 2,
          cursor: button || picked ? "pointer" : "default",
          opacity: dish?.off ? 0.55 : 1,
          minWidth: 0,
          overflow: "hidden",
          userSelect: "none",
        }}
      >
        {group && (
          <span style={{ display: "flex", justifyContent: "space-between", gap: 4, fontSize: 12.5, fontWeight: 700, lineHeight: 1.15, color: auto ? TOUCH.textDim : "#fff" }}>
            <span style={{ overflowWrap: "anywhere" }}>{group.name}</span>
            <span aria-hidden>›</span>
          </span>
        )}
        {dish && (
          <>
            <span style={{ fontSize: 12.5, fontWeight: 700, lineHeight: 1.15, overflowWrap: "anywhere" }}>{dish.name}</span>
            <span style={{ fontSize: 11.5, opacity: 0.9 }}>{dish.off ? "Off · " : ""}{dish.price}</span>
          </>
        )}
      </div>
    );
  }

  function treeRows(parentId: string | null, depth: number): ReactNode {
    const children = data.groups
      .filter((g) => g.parentId === parentId && (parentId !== null || g.department === department))
      .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
    return (
      <>
        {children.map((g: MenuGroupRow, i) => {
          const node = tree.groups[g.id];
          const count = (tree.grids[g.id] ?? []).filter((c) => c?.kind === "item").length;
          const on = level === g.id;
          return (
            <Fragment key={g.id}>
              <div data-tree-group={g.name} style={{ display: "flex", alignItems: "center", gap: 6, padding: `5px 10px 5px ${10 + depth * 16}px`, background: on ? COLORS.tealTint : "transparent" }}>
                <span style={{ width: 12, height: 12, borderRadius: 3, background: node?.colour, flexShrink: 0 }} />
                <button type="button" onClick={() => open(g.id)} style={{ flex: 1, minWidth: 0, textAlign: "left", border: "none", background: "none", padding: 0, fontSize: 13.5, fontWeight: on ? 700 : 500, color: COLORS.ink, cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {g.name} <span style={{ color: COLORS.slateMid, fontWeight: 400 }}>· {count}</span>
                </button>
                <button type="button" aria-label={`Move ${g.name} up`} disabled={i === 0} onClick={() => run(() => moveMenuGroupRank({ id: g.id, direction: "up" }))} style={{ ...small(), opacity: i === 0 ? 0.35 : 1 }}>
                  <ChevronUp size={14} />
                </button>
                <button type="button" aria-label={`Move ${g.name} down`} disabled={i === children.length - 1} onClick={() => run(() => moveMenuGroupRank({ id: g.id, direction: "down" }))} style={{ ...small(), opacity: i === children.length - 1 ? 0.35 : 1 }}>
                  <ChevronDown size={14} />
                </button>
                <button type="button" aria-label={`Edit ${g.name}`} onClick={() => setModal({ mode: "edit", group: g })} style={small()}>
                  <Pencil size={13} />
                </button>
                <button type="button" aria-label={`Add a group inside ${g.name}`} onClick={() => setModal({ mode: "add", parentId: g.id, department })} style={small()}>
                  <Plus size={14} />
                </button>
              </div>
              {treeRows(g.id, depth + 1)}
            </Fragment>
          );
        })}
      </>
    );
  }

  return (
    <div data-button-editor style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <div role="group" aria-label="Side" style={{ display: "flex", gap: 4, background: "#fff", border: `1px solid ${COLORS.border}`, borderRadius: 9, padding: 3 }}>
          {DEPARTMENTS.map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={department === d}
              data-editor-department={d}
              onClick={() => {
                setDepartment(d);
                open(null);
                setPicked(null);
              }}
              style={{ height: 32, padding: "0 18px", border: "none", borderRadius: 6, background: department === d ? DEPARTMENT_SHADES[d][0] : "transparent", color: department === d ? "#fff" : COLORS.slate, fontSize: 13, fontWeight: 700, cursor: "pointer" }}
            >
              {DEPARTMENT_LABEL[d]}
            </button>
          ))}
        </div>
        {notPlaced.length > 0 && (
          <button
            type="button"
            data-from-categories
            onClick={() => run(async () => {
              const result = await groupsFromCategories();
              if (result.ok) toast.success(`${result.dishes} ${result.dishes === 1 ? "dish" : "dishes"} placed in ${result.groups ? `${result.groups} new` : "existing"} groups.`);
              return result;
            })}
            style={{ marginLeft: "auto", height: 34, padding: "0 12px", border: `1px solid ${COLORS.teal}`, borderRadius: 8, background: "#fff", color: COLORS.tealDark, fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}
          >
            <Wand2 size={15} />
            Make groups from categories ({notPlaced.length} not placed)
          </button>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(240px, 300px) minmax(0, 1fr) minmax(220px, 280px)", gap: 14, alignItems: "start" }}>
        <Panel
          title="Groups"
          actions={
            <button type="button" onClick={() => setModal({ mode: "add", parentId: null, department })} style={{ height: 28, padding: "0 10px", border: "none", borderRadius: 7, background: COLORS.teal, color: "#fff", fontSize: 12.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
              <Plus size={14} /> Add group
            </button>
          }
        >
          <div style={{ padding: "6px 0", maxHeight: 520, overflowY: "auto" }}>
            <button type="button" data-tree-home onClick={() => open(null)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", border: "none", background: level === null ? COLORS.tealTint : "transparent", fontSize: 13.5, fontWeight: level === null ? 700 : 500, color: COLORS.ink, cursor: "pointer", textAlign: "left" }}>
              <House size={14} /> {DEPARTMENT_LABEL[department]} home
            </button>
            {treeRows(null, 1)}
            {!data.groups.some((g) => g.department === department) && (
              <p style={{ margin: "8px 14px", fontSize: 12.5, color: COLORS.slateMid }}>No {DEPARTMENT_LABEL[department]} groups yet. Add one, or make them from your categories.</p>
            )}
          </div>
        </Panel>

        <Panel
          title={picked ? `Moving ${picked.name} — tap a cell${picked.kind === "item" && !picked.fromTray ? ", or Not placed to take it off" : ""}` : "Buttons"}
          actions={picked && <button type="button" onClick={() => setPicked(null)} style={{ border: "none", background: "none", color: COLORS.slate, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>Cancel</button>}
        >
          <div style={{ background: TOUCH.frame, padding: 8, borderRadius: "0 0 12px 12px", display: "flex", flexDirection: "column", gap: 6, opacity: isPending ? 0.6 : 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, color: TOUCH.text, fontSize: 13.5, fontWeight: 700 }}>
              <nav aria-label="Breadcrumb" data-editor-breadcrumb style={{ flex: 1, display: "flex", gap: 6, minWidth: 0, overflow: "hidden", whiteSpace: "nowrap" }}>
                <button type="button" onClick={() => open(null)} style={{ border: "none", background: "none", color: level ? TOUCH.textDim : TOUCH.text, padding: 0, font: "inherit", cursor: "pointer" }}>
                  {DEPARTMENT_LABEL[department]}
                </button>
                {path.map((id) => (
                  <Fragment key={id}>
                    <span style={{ color: TOUCH.textDim }}>›</span>
                    <button type="button" onClick={() => open(id)} style={{ border: "none", background: "none", color: id === level ? TOUCH.text : TOUCH.textDim, padding: 0, font: "inherit", cursor: "pointer" }}>
                      {tree.groups[id]?.name}
                    </button>
                  </Fragment>
                ))}
              </nav>
              <button type="button" aria-label="Previous page" disabled={shownPage === 0} onClick={() => setPage(shownPage - 1)} style={{ ...small(), background: TOUCH.key, border: "none", color: "#fff", opacity: shownPage === 0 ? 0.35 : 1 }}>
                <ChevronLeft size={16} />
              </button>
              <span data-editor-page style={{ minWidth: 48, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>
                {shownPage + 1} / {pages}
              </span>
              <button type="button" aria-label="Next page" disabled={shownPage >= pages - 1} onClick={() => setPage(shownPage + 1)} style={{ ...small(), background: TOUCH.key, border: "none", color: "#fff", opacity: shownPage >= pages - 1 ? 0.35 : 1 }}>
                <ChevronRight size={16} />
              </button>
              <button type="button" disabled={!level} onClick={() => open(path.at(-2) ?? null)} style={{ height: 26, padding: "0 10px", border: "none", borderRadius: 6, background: TOUCH.key, color: "#fff", fontSize: 12.5, fontWeight: 700, display: "flex", alignItems: "center", gap: 4, opacity: level ? 1 : 0.35, cursor: level ? "pointer" : "default" }}>
                <CornerUpLeft size={13} /> Back
              </button>
            </div>
            <div data-editor-grid style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0,1fr))", gridAutoRows: 64, gap: TOUCH.gap }}>
              {Array.from({ length: GRID_SLOTS }, (_, i) => shownPage * GRID_SLOTS + i).map((index) => (
                cellView(cells[index] ?? null, index)
              ))}
            </div>
            <p style={{ margin: 0, color: TOUCH.textDim, fontSize: 12 }}>
              Drag a button onto another cell to move it (the two swap), or tap it and then tap where it goes. Double-tap a group to open it. Dashed groups are dishes not placed yet, shown under their category.
            </p>
          </div>
        </Panel>

        <Panel title={`Not placed (${tray.length})`}>
          <div
            data-tray
            onDragOver={(event) => dragging?.kind === "item" && !dragging.fromTray && event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              if (dragging) takeOff(dragging);
              setDragging(null);
            }}
            onClick={(event) => event.target === event.currentTarget && picked && takeOff(picked)}
            style={{ padding: 10, display: "flex", flexDirection: "column", gap: 8, maxHeight: 520, overflowY: "auto", minHeight: 160, background: dragging?.kind === "item" && !dragging.fromTray ? COLORS.tealTint : "#fff", borderRadius: "0 0 12px 12px" }}
          >
            <input aria-label="Find a dish" placeholder="Find a dish" value={query} onChange={(event) => setQuery(event.target.value)} style={{ height: 34, border: `1px solid ${COLORS.borderStrong}`, borderRadius: 7, padding: "0 10px", fontSize: 13 }} />
            {tray.length === 0 ? (
              <p style={{ margin: 0, fontSize: 12.5, color: COLORS.slateMid }}>{needle ? "No dishes match." : `Every ${DEPARTMENT_LABEL[department]} dish has a place.`}</p>
            ) : (
              tray.map((dish, i) => {
                const button: Picked = { kind: "item", id: dish.id, name: dish.name, fromTray: true };
                const isPicked = picked?.id === dish.id;
                return (
                  <Fragment key={dish.id}>
                    {(i === 0 || tray[i - 1].categoryName !== dish.categoryName) && <span style={{ fontSize: 11.5, fontWeight: 700, color: COLORS.slateMid, textTransform: "uppercase", letterSpacing: ".04em", marginTop: i ? 4 : 0 }}>{dish.categoryName}</span>}
                    <div
                      data-tray-dish={dish.name}
                      {...dragProps(button)}
                      onClick={() => setPicked(isPicked ? null : button)}
                      style={{ padding: "7px 10px", borderRadius: 7, border: `1px solid ${isPicked ? COLORS.teal : COLORS.borderStrong}`, background: isPicked ? COLORS.tealTint : "#fff", display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13, cursor: "grab", userSelect: "none" }}
                    >
                      <span style={{ fontWeight: 600 }}>{dish.name}</span>
                      <span style={{ color: COLORS.slateMid, whiteSpace: "nowrap" }}>{dish.price}</span>
                    </div>
                  </Fragment>
                );
              })
            )}
            {picked?.kind === "item" && !picked.fromTray && (
              <button type="button" onClick={() => takeOff(picked)} style={{ height: 34, border: `1px dashed ${COLORS.slateLight}`, borderRadius: 7, background: "#fff", color: COLORS.slate, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
                Take {picked.name} off its group
              </button>
            )}
          </div>
        </Panel>
      </div>
      {modal && <MenuGroupModal state={modal} groups={data.groups} onClose={() => setModal(null)} />}
    </div>
  );
}
