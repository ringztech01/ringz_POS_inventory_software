import Link from "next/link";
import { COLORS, FONTS } from "@/components/layout/theme";
import { APP_TIME_ZONE } from "@/lib/dateRanges";
import { CATEGORIES, CATEGORY_LABEL, type AuditCategory } from "../lib/auditEvents";
import { RESTAURANT_PERMISSIONS } from "../manifest";
import { guardPage } from "../server/guard";
import { AUDIT_LIMIT, auditFilter, getAuditView, type AuditFilter } from "../server/services/audit";

// /settings/restaurant/audit — the audit log (Part 6f Step 7e): sign-ins,
// failed PINs, managers' overrides, voids, the cash drawer, PIN and card
// changes, staff and roles, the till and shifts, devices — newest first,
// for some days, one person and one kind. View Audit Log (Managers and the
// Administrator); a 404 while the module is off. A plain GET form: the
// filters are in the address.

const when = new Intl.DateTimeFormat("en-GB", { timeZone: APP_TIME_ZONE, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
const TONE: Record<AuditCategory, { bg: string; ink: string }> = {
  SIGNIN: { bg: "#E6F4EF", ink: "#0B6B58" },
  FAILED: { bg: "#FCE8E6", ink: "#B42318" },
  OVERRIDE: { bg: "#FFF2DB", ink: "#8A5300" },
  VOID: { bg: "#FCE8E6", ink: "#B42318" },
  DRAWER: { bg: "#EAF0FB", ink: "#2457A6" },
  PIN: { bg: "#F1ECFA", ink: "#5B3AA3" },
  STAFF: { bg: "#EEF1F2", ink: "#3E4A4D" },
  TILL: { bg: "#E6F4EF", ink: "#0B6B58" },
  DEVICE: { bg: "#EEF1F2", ink: "#3E4A4D" },
};

const hrefWith = (f: AuditFilter, change: Partial<AuditFilter>) => {
  const next = { ...f, ...change };
  const q = new URLSearchParams({ from: next.from, to: next.to });
  if (next.userId) q.set("user", next.userId);
  if (next.category) q.set("type", next.category);
  return `/settings/restaurant/audit?${q.toString()}`;
};

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const denied = await guardPage(RESTAURANT_PERMISSIONS.VIEW_AUDIT_LOG);
  if (denied) return denied;
  const params = await searchParams;
  const one = (k: string) => (Array.isArray(params[k]) ? params[k]![0] : params[k]);
  const view = await getAuditView(auditFilter({ from: one("from"), to: one("to"), user: one("user"), type: one("type") }));
  const f = view.filter;
  const field = { height: 38, border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: "0 10px", fontSize: 13.5, background: "#fff" } as const;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, maxWidth: 760 }}>
        <h1 style={{ margin: 0, fontFamily: FONTS.display, fontSize: 24, fontWeight: 600, letterSpacing: "-.01em" }}>Audit log</h1>
        <p style={{ margin: 0, fontSize: 13.5, color: COLORS.slateMid, lineHeight: 1.5 }}>
          Who did what, and when: sign-ins and failed PINs, managers&apos; overrides, voids, the cash drawer, PIN and card changes, staff, the till and shifts. PINs and card numbers are never recorded.
        </p>
      </div>

      <form method="GET" action="/settings/restaurant/audit" data-audit-filter style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap", background: "#fff", border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: "14px 18px" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12.5, fontWeight: 600 }}>
          From
          <input type="date" name="from" defaultValue={f.from} data-audit-from style={field} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12.5, fontWeight: 600 }}>
          To
          <input type="date" name="to" defaultValue={f.to} data-audit-to style={field} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12.5, fontWeight: 600 }}>
          Person
          <select name="user" defaultValue={f.userId ?? ""} data-audit-user style={{ ...field, minWidth: 200 }}>
            <option value="">Everyone</option>
            {view.people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        {f.category && <input type="hidden" name="type" value={f.category} />}
        <button type="submit" data-audit-show style={{ height: 38, padding: "0 18px", borderRadius: 8, border: "none", background: COLORS.teal, color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
          Show
        </button>
      </form>

      <nav aria-label="Kind" data-audit-kinds style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <Link href={hrefWith(f, { category: null })} aria-current={!f.category ? "page" : undefined} style={chip(!f.category)}>
          All · {Object.values(view.counts).reduce((a, b) => a + b, 0)}
        </Link>
        {CATEGORIES.map((c) => (
          <Link key={c} href={hrefWith(f, { category: c })} data-audit-kind={c} aria-current={f.category === c ? "page" : undefined} style={chip(f.category === c)}>
            {CATEGORY_LABEL[c]} · {view.counts[c]}
          </Link>
        ))}
      </nav>

      <section style={{ background: "#fff", border: `1px solid ${COLORS.border}`, borderRadius: 12, overflow: "auto" }}>
        {view.rows.length === 0 ? (
          <p data-audit-empty style={{ margin: 0, padding: 24, fontSize: 14, color: COLORS.slateMid }}>
            Nothing recorded for these days{f.userId ? " and this person" : ""}{f.category ? ` (${CATEGORY_LABEL[f.category]})` : ""}.
          </p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
            <thead>
              <tr style={{ textAlign: "left", fontSize: 12, color: COLORS.slateMid, textTransform: "uppercase", letterSpacing: ".04em" }}>
                {["When", "Who", "Kind", "What", "Details", "Where"].map((h) => (
                  <th key={h} style={{ padding: "10px 14px", fontWeight: 600, whiteSpace: "nowrap" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.rows.map((r) => (
                <tr key={r.id} data-audit-row={r.category} style={{ borderTop: `1px solid ${COLORS.border}` }}>
                  <td style={{ padding: "9px 14px", whiteSpace: "nowrap", color: COLORS.slateMid, fontFamily: FONTS.mono, fontSize: 12.5 }}>{when.format(new Date(r.at))}</td>
                  <td style={{ padding: "9px 14px", whiteSpace: "nowrap" }}>
                    {r.whoId ? (
                      <Link href={hrefWith(f, { userId: r.whoId })} style={{ color: COLORS.ink, fontWeight: 600, textDecoration: "none" }}>
                        {r.who ?? "Someone removed"}
                      </Link>
                    ) : (
                      <span style={{ color: COLORS.slateMid }}>—</span>
                    )}
                  </td>
                  <td style={{ padding: "9px 14px", whiteSpace: "nowrap" }}>
                    <span style={{ fontSize: 11.5, fontWeight: 700, padding: "3px 8px", borderRadius: 999, background: TONE[r.category].bg, color: TONE[r.category].ink }}>{CATEGORY_LABEL[r.category]}</span>
                  </td>
                  <td style={{ padding: "9px 14px" }} data-audit-what>
                    {r.what}
                  </td>
                  <td style={{ padding: "9px 14px", color: COLORS.slateMid }}>{r.detail ?? ""}</td>
                  <td style={{ padding: "9px 14px", color: COLORS.slateMid, whiteSpace: "nowrap" }}>{r.where ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {view.more && <p style={{ margin: 0, fontSize: 13, color: COLORS.slateMid }}>Showing the newest {AUDIT_LIMIT}. Pick fewer days, one person or one kind to see the rest.</p>}
    </div>
  );
}

function chip(on: boolean) {
  return { height: 32, padding: "0 12px", borderRadius: 8, display: "inline-flex", alignItems: "center", fontSize: 13, fontWeight: 600, textDecoration: "none", background: on ? COLORS.teal : "#fff", color: on ? "#fff" : COLORS.slate, border: `1px solid ${on ? COLORS.teal : COLORS.border}` } as const;
}
