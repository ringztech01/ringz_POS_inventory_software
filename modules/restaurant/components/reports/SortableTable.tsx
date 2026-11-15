"use client";

import Link from "next/link";
import { Fragment, type CSSProperties, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp } from "lucide-react";
import { COLORS, FONTS } from "@/components/layout/theme";
import { resolveSort, sortRows } from "../../lib/reportSort";

export { sortRows };

export type SortableColumn = { key: string; label: string; width: string; align?: "right"; title?: string };

export type SortableRow = {
  id: string;
  // What each column shows (already formatted).
  cells: Record<string, string>;
  // What each column sorts by (null: unknown — last either way).
  sort: Record<string, number | string | null>;
  // The first column links to the report with this filter set (e.g. the
  // waiter), keeping the others.
  filter?: { param: string; value: string; title: string } | null;
  // Or the first column links elsewhere (Waste: Food › Waste with filters).
  link?: { href: string; title: string } | null;
  // Its group's key (see `groups`).
  group?: string;
  // Highlighted (Voids & discounts: over the approval limit), with why;
  // red for a cash-up over its variance limit.
  flag?: string | null;
  flagTone?: "amber" | "red";
  // The trailing column's content (e.g. a Reprint button).
  trailing?: ReactNode;
};

// Optional groups (By table: dining areas), in order, each with its
// subtotal row; the rows sort within their group.
export type SortableGroup = { key: string; label: string; totals: Record<string, string> };

const headerText: CSSProperties = { fontSize: 11.5, fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", color: COLORS.slateMid };


// A Restaurant Reports table (the retail Reports' look): click a heading to
// sort by it, again to reverse; the sort is in the URL (?sort&dir) so a link
// and the export show the same. A total row last.
export default function SortableTable({
  columns,
  rows,
  totals,
  defaultSort,
  defaultDir = "desc",
  textColumns = [],
  data,
  groups,
  groupToggle,
  param = "",
  trailing,
}: {
  columns: SortableColumn[];
  rows: SortableRow[];
  totals: Record<string, string> | null;
  defaultSort: string;
  defaultDir?: "asc" | "desc";
  // Columns sorted A→Z first (the others largest first).
  textColumns?: string[];
  // data-* name for the rows ("waiter" → data-waiter-row).
  data: string;
  groups?: SortableGroup[];
  // The switch's label ("Group by area"); on unless ?group=0.
  groupToggle?: string;
  // Several tables on one page: each its own URL keys (?refundsort=…).
  param?: string;
  // A last column that doesn't sort (each row's `trailing`).
  trailing?: { label: string; width: string };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const keys = { sort: `${param}sort`, dir: `${param}dir`, group: `${param}group` };
  const { sort, dir } = resolveSort(params, { param, columns, defaultSort, defaultDir, textColumns });
  const first = columns[0].key;
  const sorted = sortRows(rows, sort, dir, first);
  const grouped = !!groups && params.get(keys.group) !== "0";
  const setGrouped = (on: boolean) => {
    const next = new URLSearchParams(params.toString());
    if (on) next.delete(keys.group);
    else next.set(keys.group, "0");
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };
  const grid = [...columns.map((c) => c.width), ...(trailing ? [trailing.width] : [])].join(" ");
  const minWidth = [...columns, ...(trailing ? [trailing] : [])].reduce((w, c) => w + (parseInt(c.width.replace(/^minmax\(/, ""), 10) || 100) + 14, 40);

  const sortBy = (key: string) => {
    const next = new URLSearchParams(params.toString());
    next.set(keys.sort, key);
    next.set(keys.dir, key === sort ? (dir === "asc" ? "desc" : "asc") : textColumns.includes(key) ? "asc" : "desc");
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };
  const filterHref = (f: NonNullable<SortableRow["filter"]>) => {
    const next = new URLSearchParams(params.toString());
    next.set(f.param, f.value);
    return `${pathname}?${next.toString()}`;
  };
  const rowOf = (r: SortableRow): ReactNode => (
    <div
      key={r.id}
      title={r.flag ?? undefined}
      data-flagged={r.flag ? "" : undefined}
      style={r.flag ? { ...rowStyle, ...(r.flagTone === "red" ? { background: "#fcecef", boxShadow: "inset 3px 0 0 #b4233c" } : { background: "#fdf4e3", boxShadow: "inset 3px 0 0 #c98a12" }) } : rowStyle}
      {...{ [`data-${data}-row`]: r.cells[first] }}
    >
      {columns.map((c) => (
        <span key={c.key} style={cellStyle(c)}>
          {c.key === first && r.filter ? (
            <Link href={filterHref(r.filter)} title={r.filter.title} data-report-filter-link={r.filter.value} style={{ color: COLORS.tealDark, fontWeight: 600, textDecoration: "none" }}>
              {r.cells[c.key]}
            </Link>
          ) : c.key === first && r.link ? (
            <Link href={r.link.href} title={r.link.title} data-report-row-link={r.link.href} style={{ color: COLORS.tealDark, fontWeight: 600, textDecoration: "none" }}>
              {r.cells[c.key]}
            </Link>
          ) : (
            r.cells[c.key]
          )}
        </span>
      ))}
      {trailing && <span style={{ display: "flex", justifyContent: "flex-end" }}>{r.trailing ?? null}</span>}
    </div>
  );
  const rowStyle: CSSProperties = { display: "grid", gridTemplateColumns: grid, columnGap: 14, alignItems: "center", padding: "0 20px", minHeight: 46, borderBottom: `1px solid ${COLORS.border}`, fontSize: 13.5 };
  const cellStyle = (c: SortableColumn): CSSProperties => ({ textAlign: c.align ?? "left", fontFamily: c.align ? FONTS.mono : undefined, fontSize: c.align ? 13 : undefined, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" });

  const table = (
    <div style={{ background: "#fff", border: `1px solid ${COLORS.border}`, borderRadius: 12, overflow: "hidden" }}>
      <div style={{ overflowX: "auto" }}>
        <div style={{ minWidth }} data-report-table={data}>
          <div role="row" style={{ ...rowStyle, minHeight: 48, background: COLORS.bgInput, whiteSpace: "nowrap" }}>
            {columns.map((c) => (
              <span key={c.key} role="columnheader" title={c.title} aria-sort={sort === c.key ? (dir === "asc" ? "ascending" : "descending") : "none"} style={{ display: "flex", justifyContent: c.align === "right" ? "flex-end" : "flex-start" }}>
                <button
                  type="button"
                  data-report-sort={c.key}
                  onClick={() => sortBy(c.key)}
                  style={{ ...headerText, border: "none", background: "transparent", padding: 0, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4, color: sort === c.key ? COLORS.tealDark : COLORS.slateMid }}
                >
                  {c.label}
                  {sort === c.key && (dir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                </button>
              </span>
            ))}
            {trailing && <span style={{ ...headerText, textAlign: "right" }}>{trailing.label}</span>}
          </div>
          {grouped
            ? groups!.map((g) => (
                <Fragment key={g.key}>
                  <div style={{ ...rowStyle, background: "#eef3f2", minHeight: 40, fontWeight: 600 }} {...{ [`data-${data}-group`]: g.label }}>
                    {columns.map((c) => (
                      <span key={c.key} style={cellStyle(c)}>
                        {c.key === first ? g.label : (g.totals[c.key] ?? "")}
                      </span>
                    ))}
                    {trailing && <span />}
                  </div>
                  {sorted.filter((r) => r.group === g.key).map(rowOf)}
                </Fragment>
              ))
            : sorted.map(rowOf)}
          {totals && (
            <div style={{ ...rowStyle, background: COLORS.bgInput, borderBottom: "none", fontWeight: 700 }} data-report-total="">
              {columns.map((c) => (
                <span key={c.key} style={cellStyle(c)}>
                  {totals[c.key] ?? ""}
                </span>
              ))}
              {trailing && <span />}
            </div>
          )}
        </div>
      </div>
    </div>
  );
  if (!groups || !groupToggle) return table;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <label data-no-print style={{ alignSelf: "flex-end", display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, color: COLORS.text, cursor: "pointer" }}>
        <input type="checkbox" data-report-group-toggle={data} checked={grouped} onChange={(e) => setGrouped(e.target.checked)} style={{ width: 16, height: 16, accentColor: COLORS.teal }} />
        {groupToggle}
      </label>
      {table}
    </div>
  );
}
