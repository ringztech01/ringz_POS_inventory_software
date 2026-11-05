"use client";

import { Suspense, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { COLORS, FONTS } from "@/components/layout/theme";
import { DRAWER_REASON_LABEL, drawerOutcome } from "@/lib/hardware/drawerKick";
import type { DrawerEventRow } from "@/lib/hardware/drawerLog";

// The drawer log (Settings › Printers › Drawer log): newest first,
// refreshed every 10 s, filtered by reason in the URL.

const REFRESH_MS = 10_000;
const TONE = { ok: { bg: "#eff8f6", fg: "#0a6355" }, wait: { bg: "#fff4e0", fg: "#8a5a00" }, bad: { bg: "#fcecef", fg: "#b4233c" } } as const;
const REASONS = Object.entries(DRAWER_REASON_LABEL) as [keyof typeof DRAWER_REASON_LABEL, string][];

const th = { padding: "10px 12px", fontSize: 11.5, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: COLORS.slateMid, textAlign: "left", whiteSpace: "nowrap", background: COLORS.bgInput } as const;
const td = { padding: "10px 12px", borderTop: `1px solid ${COLORS.border}`, fontSize: 13, verticalAlign: "top" } as const;
const select = { height: 38, border: `1px solid ${COLORS.borderStrong}`, borderRadius: 8, padding: "0 10px", fontSize: 13.5, background: "#fff" } as const;

const time = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(new Date(iso)).replace(",", "");

function ReasonFilter({ reason, counts }: { reason: string; counts: Record<string, number> }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const set = (value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set("reason", value);
    else next.delete("reason");
    next.delete("page");
    router.push(`${pathname}?${next.toString()}`);
  };
  return (
    <select aria-label="Reason" value={reason} onChange={(e) => set(e.target.value)} style={select}>
      <option value="">Every reason</option>
      {REASONS.map(([key, label]) => (
        <option key={key} value={key}>
          {label} ({counts[key] ?? 0})
        </option>
      ))}
    </select>
  );
}

export default function DrawerLogPanel({ rows, counts, reason, page, total, totalPages }: { rows: DrawerEventRow[]; counts: Record<string, number>; reason: string; page: number; total: number; totalPages: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [router]);
  const link = (to: number) => `?${new URLSearchParams({ ...(reason ? { reason } : {}), page: String(to) })}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <Link href="/settings/printers" aria-label="Back to Printers" style={{ width: 34, height: 34, borderRadius: 8, border: `1px solid ${COLORS.border}`, display: "flex", alignItems: "center", justifyContent: "center", color: COLORS.slate }}>
          <ChevronLeft size={16} strokeWidth={1.8} />
        </Link>
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: 0, fontFamily: FONTS.display, fontSize: 26, fontWeight: 700, letterSpacing: "-.015em" }}>Drawer log</h1>
          <p style={{ margin: "2px 0 0", fontSize: 13.5, color: COLORS.slateMid }}>Every time the cash drawer was told to open — cash sales and refunds, by hand (with the reason given) and tests.</p>
        </div>
        <Suspense fallback={null}>
          <ReasonFilter reason={reason} counts={counts} />
        </Suspense>
      </div>

      <section aria-label="Drawer events" style={{ background: "#fff", border: `1px solid ${COLORS.border}`, borderRadius: 12, overflow: "hidden" }}>
        {rows.length === 0 ? (
          <p data-empty style={{ margin: 0, padding: 24, fontSize: 13.5, color: COLORS.slateMid }}>
            The drawer hasn&apos;t been opened{reason ? " for this reason" : ""} yet.
          </p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["When", "Why", "By", "Till", "Drawer on", "Result"].map((h) => (
                  <th key={h} style={th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => {
                const outcome = drawerOutcome(e.status);
                const tone = TONE[outcome.tone];
                return (
                  <tr key={e.id} data-drawer-event={e.id} data-reason={e.reason} data-status={e.status}>
                    <td style={{ ...td, fontFamily: FONTS.mono, fontSize: 12, whiteSpace: "nowrap" }}>{time(e.createdAt)}</td>
                    <td style={td}>
                      <span style={{ fontWeight: 600 }}>{DRAWER_REASON_LABEL[e.reason]}</span>
                      {e.ref && <span style={{ marginLeft: 6, fontFamily: FONTS.mono, fontSize: 12, color: COLORS.slateMid }}>{e.ref}</span>}
                      {e.note && <span style={{ display: "block", fontSize: 12.5, color: COLORS.slate }}>“{e.note}”</span>}
                    </td>
                    <td style={td}>{e.by ?? "—"}</td>
                    <td style={td}>{e.device ?? "—"}</td>
                    <td style={td}>{e.printer}</td>
                    <td style={td}>
                      <span style={{ height: 22, padding: "0 9px", borderRadius: 11, background: tone.bg, color: tone.fg, fontSize: 11.5, fontWeight: 600, display: "inline-flex", alignItems: "center", whiteSpace: "nowrap" }}>{outcome.label}</span>
                      {outcome.tone === "bad" && e.error && <span style={{ display: "block", marginTop: 4, fontSize: 12, color: COLORS.slateMid, maxWidth: 280 }}>{e.error.replace(/^Try \d of \d failed: /, "").replace(/^Not opened — (.)/, (_, first: string) => first.toUpperCase())}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", borderTop: `1px solid ${COLORS.border}`, fontSize: 13, color: COLORS.slateMid }}>
          <span>
            {total} {total === 1 ? "opening" : "openings"}
          </span>
          <span style={{ display: "flex", gap: 8 }}>
            {page > 1 && <Link href={link(page - 1)}>← Newer</Link>}
            {page < totalPages && <Link href={link(page + 1)}>Older →</Link>}
          </span>
        </div>
      </section>
    </div>
  );
}
