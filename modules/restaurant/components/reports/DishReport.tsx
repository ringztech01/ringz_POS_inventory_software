"use client";

import { Fragment, useState, type CSSProperties, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight } from "lucide-react";
import { COLORS, FONTS } from "@/components/layout/theme";
import { formatNaira } from "@/lib/format";
import { dishViewFrom, groupDishes, MENU_CLASS_HINT, MENU_CLASS_LABEL, quadrants, sortDishes, type DishLine, type DishSort, type DishTotals, type MenuClass } from "../../lib/reportDishes";
import { DEPARTMENT_LABEL } from "../../lib/reportOverview";
import { formatOpenFor } from "../../lib/time";

type Column = { key: DishSort | "class"; label: string; width: string; align?: "right"; cost?: boolean; engineering?: boolean };

const COLUMNS: Column[] = [
  { key: "name", label: "Dish", width: "minmax(190px,1.6fr)" },
  { key: "department", label: "Department", width: "100px" },
  { key: "group", label: "Group", width: "minmax(120px,1fr)" },
  { key: "quantity", label: "Qty sold", width: "80px", align: "right" },
  { key: "gross", label: "Gross sales", width: "120px", align: "right" },
  { key: "discount", label: "Discounts", width: "110px", align: "right" },
  { key: "net", label: "Net sales", width: "120px", align: "right" },
  { key: "cost", label: "Food cost", width: "110px", align: "right", cost: true },
  { key: "margin", label: "Margin", width: "110px", align: "right", cost: true },
  { key: "marginPct", label: "Margin %", width: "90px", align: "right", cost: true },
  { key: "share", label: "% of sales", width: "90px", align: "right" },
  { key: "minutes86", label: "86'd", width: "80px", align: "right" },
  { key: "class", label: "Class", width: "110px", engineering: true },
];

const CLASS_STYLE: Record<MenuClass, { bg: string; ink: string }> = {
  STAR: { bg: "#eaf6f3", ink: "#0a6355" },
  PLOWHORSE: { bg: "#eaf1fb", ink: "#1d5fa8" },
  PUZZLE: { bg: "#fdf4e3", ink: "#8a5a00" },
  DOG: { bg: "#fcecef", ink: "#b4233c" },
};

const headerText: CSSProperties = { fontSize: 11.5, fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", color: COLORS.slateMid };
const money = (v: string | null) => (v === null ? "—" : formatNaira(v));
const percent = (v: number | null) => (v === null ? "—" : `${v.toFixed(1)}%`);

function ClassPill({ value }: { value: MenuClass | null }) {
  if (!value) return <span style={{ fontSize: 12, color: COLORS.slateLight }}>Not classed</span>;
  const c = CLASS_STYLE[value];
  return (
    <span data-menu-class={value} style={{ display: "inline-block", padding: "2px 9px", borderRadius: 999, background: c.bg, color: c.ink, fontSize: 12, fontWeight: 600 }}>
      {MENU_CLASS_LABEL[value]}
    </span>
  );
}

function Toggle({ label, on, onChange, data }: { label: string; on: boolean; onChange: (on: boolean) => void; data: string }) {
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, color: COLORS.text, cursor: "pointer" }}>
      <input type="checkbox" data-dish-toggle={data} checked={on} onChange={(e) => onChange(e.target.checked)} style={{ width: 16, height: 16, accentColor: COLORS.teal }} />
      {label}
    </label>
  );
}

// Restaurant Reports › By dish (Step 3). Every column sorts; grouped, the
// dishes sit under their department and group with subtotals; a dish with
// options opens to show them. Menu engineering (View Cost) classes each
// dish. Sort, grouping and view are in the URL (a link, and the export,
// show the same).
export default function DishReport({ lines, totals, withCost, logSince, notes }: { lines: DishLine[]; totals: DishTotals; withCost: boolean; logSince: string | null; notes: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [open, setOpen] = useState<Set<string>>(new Set());

  const { sort, dir, grouped, engineering } = dishViewFrom(params, withCost);

  function set(changes: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }
  const sortBy = (key: DishSort) => set({ sort: key, dir: key === sort ? (dir === "asc" ? "desc" : "asc") : ["name", "department", "group"].includes(key) ? "asc" : "desc" });

  const columns = COLUMNS.filter((c) => (!c.cost || withCost) && (!c.engineering || engineering));
  const grid = columns.map((c) => c.width).join(" ");
  const minWidth = columns.reduce((w, c) => w + (parseInt(c.width.replace(/^minmax\(/, ""), 10) || 100) + 14, 40);
  const sorted = sortDishes(lines, sort, dir);

  const cell = (c: Column, line: DishLine): ReactNode => {
    switch (c.key) {
      case "name":
        return line.name;
      case "department":
        return DEPARTMENT_LABEL[line.department] === "Not on a menu button" ? "—" : DEPARTMENT_LABEL[line.department];
      case "group":
        return line.group ?? "—";
      case "quantity":
        return line.quantity;
      case "gross":
        return money(line.gross);
      case "discount":
        return money(line.discount);
      case "net":
        return <strong>{money(line.net)}</strong>;
      case "cost":
        return (
          <span title={line.costMissing ? `${line.costMissing} sold with no cost, left out` : undefined}>
            {money(line.cost)}
            {line.costMissing > 0 && line.cost !== null ? " *" : ""}
          </span>
        );
      case "margin":
        return money(line.margin);
      case "marginPct":
        return percent(line.marginPct);
      case "share":
        return percent(line.share);
      case "minutes86":
        return line.minutes86 === null ? "—" : line.minutes86 === 0 ? "0" : formatOpenFor(line.minutes86);
      case "class":
        return <ClassPill value={line.menuClass} />;
    }
  };
  const totalCell = (c: Column, t: DishTotals): ReactNode => {
    switch (c.key) {
      case "quantity":
        return t.quantity;
      case "gross":
        return money(t.gross);
      case "discount":
        return money(t.discount);
      case "net":
        return money(t.net);
      case "cost":
        return money(t.cost);
      case "margin":
        return money(t.margin);
      case "marginPct":
        return percent(t.marginPct);
      case "share":
        return totals.net !== "0.00" && Number(totals.net) > 0 ? percent(Math.round((Number(t.net) / Number(totals.net)) * 1000) / 10) : "—";
      default:
        return null;
    }
  };

  const row = (children: ReactNode, style: CSSProperties = {}, data: Record<string, string> = {}) => (
    <div {...data} style={{ display: "grid", gridTemplateColumns: grid, columnGap: 14, alignItems: "center", padding: "0 20px", minHeight: 46, borderBottom: `1px solid ${COLORS.border}`, fontSize: 13.5, ...style }}>
      {children}
    </div>
  );

  const dishRow = (line: DishLine) => {
    const expandable = line.modifiers.length > 0;
    const isOpen = open.has(line.productId);
    return (
      <Fragment key={line.productId}>
        {row(
          columns.map((c) => (
            <span key={c.key} style={{ textAlign: c.align ?? "left", fontFamily: c.align ? FONTS.mono : undefined, fontSize: c.align ? 13 : undefined, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {c.key === "name" ? (
                <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                  {expandable ? (
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      aria-label={`${isOpen ? "Hide" : "Show"} ${line.name}'s options`}
                      data-dish-expand={line.name}
                      onClick={() => setOpen((s) => (s.has(line.productId) ? new Set([...s].filter((x) => x !== line.productId)) : new Set([...s, line.productId])))}
                      style={{ width: 22, height: 22, border: "none", borderRadius: 6, background: COLORS.bgApp, color: COLORS.slate, display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
                    >
                      {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </button>
                  ) : (
                    <span aria-hidden style={{ display: "inline-block", width: 22, height: 22, flexShrink: 0 }} />
                  )}
                  {cell(c, line)}
                </span>
              ) : (
                cell(c, line)
              )}
            </span>
          )),
          {},
          { "data-dish-row": line.name },
        )}
        {isOpen && (
          <div data-dish-options={line.name} style={{ background: COLORS.bgApp, borderBottom: `1px solid ${COLORS.border}`, padding: "8px 20px 10px 62px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(160px,1fr) minmax(120px,1fr) 110px 140px", columnGap: 14, ...headerText, fontSize: 10.5, padding: "4px 0" }}>
              <span>Option</span>
              <span>Group</span>
              <span style={{ textAlign: "right" }}>Times chosen</span>
              <span style={{ textAlign: "right" }}>Price changes</span>
            </div>
            {line.modifiers.map((m) => (
              <div key={`${m.group}:${m.name}`} data-dish-option={m.name} style={{ display: "grid", gridTemplateColumns: "minmax(160px,1fr) minmax(120px,1fr) 110px 140px", columnGap: 14, fontSize: 13, padding: "4px 0" }}>
                <span>{m.name}</span>
                <span style={{ color: COLORS.slate }}>{m.group ?? "—"}</span>
                <span style={{ textAlign: "right", fontFamily: FONTS.mono }}>{m.times}</span>
                <span style={{ textAlign: "right", fontFamily: FONTS.mono }}>{formatNaira(m.revenue)}</span>
              </div>
            ))}
          </div>
        )}
      </Fragment>
    );
  };

  const subtotalRow = (label: string, t: DishTotals, level: "department" | "group", key: string) =>
    row(
      columns.map((c) => (
        <span key={c.key} style={{ textAlign: c.align ?? "left", fontFamily: c.align ? FONTS.mono : undefined, fontSize: c.align ? 13 : undefined, fontWeight: 600 }}>
          {c.key === "name" ? label : totalCell(c, t)}
        </span>
      )),
      { background: level === "department" ? "#eef3f2" : "#f7f9f9", minHeight: 40 },
      { [`data-dish-${level}`]: key },
    );

  const quads = engineering ? quadrants(lines) : null;

  return (
    <div data-dish-report style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
        <span data-dish-count={lines.length} style={{ fontSize: 13, color: COLORS.slateMid }}>
          {lines.length} {lines.length === 1 ? "dish" : "dishes"}
        </span>
        <span style={{ flex: 1 }} />
        <span data-no-print style={{ display: "contents" }}>
        <Toggle label="Group by department" data="group" on={grouped} onChange={(on) => set({ group: on ? "1" : null })} />
        {withCost && <Toggle label="Menu engineering" data="engineering" on={engineering} onChange={(on) => set({ view: on ? "engineering" : null })} />}
        </span>
      </div>

      {quads && (
        <div data-menu-quadrants style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 12 }}>
          {(["STAR", "PUZZLE", "PLOWHORSE", "DOG"] as const).map((k) => (
            <div key={k} data-quadrant={k} style={{ background: CLASS_STYLE[k].bg, borderRadius: 12, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: CLASS_STYLE[k].ink }}>{MENU_CLASS_LABEL[k]}</span>
              <span style={{ fontFamily: FONTS.display, fontSize: 22, fontWeight: 600 }}>
                {quads[k].dishes} {quads[k].dishes === 1 ? "dish" : "dishes"} · {formatNaira(quads[k].net)}
              </span>
              <span style={{ fontSize: 12.5, color: CLASS_STYLE[k].ink }}>{MENU_CLASS_HINT[k]}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ background: "#fff", border: `1px solid ${COLORS.border}`, borderRadius: 12, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth }}>
            <div role="row" style={{ display: "grid", gridTemplateColumns: grid, columnGap: 14, alignItems: "center", padding: "0 20px", height: 48, background: COLORS.bgInput, borderBottom: `1px solid ${COLORS.border}`, whiteSpace: "nowrap" }}>
              {columns.map((c) =>
                c.key === "class" ? (
                  <span key={c.key} style={headerText}>
                    {c.label}
                  </span>
                ) : (
                  <span key={c.key} role="columnheader" aria-sort={sort === c.key ? (dir === "asc" ? "ascending" : "descending") : "none"} style={{ display: "flex", justifyContent: c.align === "right" ? "flex-end" : "flex-start" }}>
                    <button
                      type="button"
                      data-dish-sort={c.key}
                      onClick={() => sortBy(c.key as DishSort)}
                      style={{ ...headerText, border: "none", background: "transparent", padding: 0, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4, color: sort === c.key ? COLORS.tealDark : COLORS.slateMid }}
                    >
                      {c.label}
                      {sort === c.key && (dir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                    </button>
                  </span>
                ),
              )}
            </div>
            {grouped
              ? groupDishes(sorted, withCost).map((d) => (
                  <Fragment key={d.department}>
                    {subtotalRow(DEPARTMENT_LABEL[d.department], d.totals, "department", d.department)}
                    {d.groups.map((g) => (
                      <Fragment key={g.key}>
                        {subtotalRow(`  ${g.group ?? "No group"}`, g.totals, "group", g.key)}
                        {g.lines.map(dishRow)}
                      </Fragment>
                    ))}
                  </Fragment>
                ))
              : sorted.map(dishRow)}
            {row(
              columns.map((c) => (
                <span key={c.key} style={{ textAlign: c.align ?? "left", fontFamily: c.align ? FONTS.mono : undefined, fontSize: c.align ? 13 : undefined, fontWeight: 700 }}>
                  {c.key === "name" ? "Total" : totalCell(c, totals)}
                </span>
              )),
              { background: COLORS.bgInput, borderBottom: "none" },
              { "data-dish-total": "" },
            )}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5, color: COLORS.slateMid }}>
        {notes}
        <span data-dish-note="86">
          {logSince ? `86'd: minutes each dish was switched off in the period, recorded since ${logSince}. Out of stock isn't recorded.` : "86'd: nothing has been switched off since the 86 log began, so there's no history yet."}
        </span>
      </div>
    </div>
  );
}
