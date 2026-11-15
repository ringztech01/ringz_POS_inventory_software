// The report tables' sort (Restaurant Reports): by a column, either way;
// unknown values (null) last either way; ties by the first column. Shared by
// the on-screen tables and the Excel export, so both come out in one order.

export type SortValues = { sort: Record<string, number | string | null> };

export function sortRows<T extends SortValues>(rows: readonly T[], key: string, dir: "asc" | "desc", tie: string): T[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = a.sort[key] ?? null;
    const y = b.sort[key] ?? null;
    if (x === null && y !== null) return 1;
    if (y === null && x !== null) return -1;
    if (x !== null && y !== null && x !== y) return sign * (typeof x === "string" && typeof y === "string" ? x.localeCompare(y) : Number(x) - Number(y));
    return String(a.sort[tie] ?? "").localeCompare(String(b.sort[tie] ?? ""));
  });
}

// A table's sort from the URL (?<param>sort, ?<param>dir): a known column,
// else its default; the direction as given, else the default one for its
// default column, A→Z for a text column, largest first otherwise.
export function resolveSort(
  params: { get(name: string): string | null },
  table: { param?: string; columns: readonly { key: string }[]; defaultSort: string; defaultDir?: "asc" | "desc"; textColumns?: readonly string[] },
): { sort: string; dir: "asc" | "desc" } {
  const p = table.param ?? "";
  const asked = params.get(`${p}sort`);
  const sort = table.columns.some((c) => c.key === asked) ? asked! : table.defaultSort;
  const given = params.get(`${p}dir`);
  const dir: "asc" | "desc" = given === "asc" || given === "desc" ? given : sort === table.defaultSort ? (table.defaultDir ?? "desc") : (table.textColumns ?? []).includes(sort) ? "asc" : "desc";
  return { sort, dir };
}
