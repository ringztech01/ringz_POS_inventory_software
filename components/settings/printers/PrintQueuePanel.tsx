"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import toast from "react-hot-toast";
import { ChevronLeft } from "lucide-react";
import { COLORS, FONTS } from "@/components/layout/theme";
import { cancelJob, reprintJob, retryJob } from "@/app/(dashboard)/settings/print-queue/actions";
import type { PrintJobRow } from "@/lib/hardware/printJobs";

// The print queue (Settings › Printers › Print queue): every job, newest
// first, refreshed every 5 s. Filters in the URL.

const REFRESH_MS = 5000;
const STATUS: Record<string, { label: string; bg: string; fg: string }> = {
  QUEUED: { label: "Waiting", bg: "#eaf1fb", fg: "#1d5fa8" },
  PRINTING: { label: "Printing", bg: "#fff4e0", fg: "#8a5a00" },
  DONE: { label: "Printed", bg: "#eff8f6", fg: "#0a6355" },
  FAILED: { label: "Failed", bg: "#fcecef", fg: "#b4233c" },
  CANCELLED: { label: "Cancelled", bg: "#eef1f2", fg: "#4d5659" },
};
const TYPE: Record<string, string> = { KOT: "KOT", KOT_VOID: "VOID KOT", RECEIPT: "Receipt", PREBILL: "Pre-bill", REPORT: "Report", TEST: "Test page", DRAWER: "Cash drawer" };

const th = { padding: "10px 12px", fontSize: 11.5, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: COLORS.slateMid, textAlign: "left", whiteSpace: "nowrap", background: COLORS.bgInput } as const;
const td = { padding: "10px 12px", borderTop: `1px solid ${COLORS.border}`, fontSize: 13, verticalAlign: "top" } as const;
const small = { height: 30, padding: "0 10px", border: `1px solid ${COLORS.borderStrong}`, borderRadius: 7, background: "#fff", fontSize: 12.5, fontWeight: 600, cursor: "pointer" } as const;
const select = { height: 38, border: `1px solid ${COLORS.borderStrong}`, borderRadius: 8, padding: "0 10px", fontSize: 13.5, background: "#fff" } as const;

const time = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(new Date(iso)).replace(",", "");

function Filters({ printers, printerId, status, counts }: { printers: { id: string; name: string }[]; printerId: string; status: string; counts: Record<string, number> }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("page");
    router.push(`${pathname}?${next.toString()}`);
  };
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
      <select aria-label="Printer" value={printerId} onChange={(e) => set("printer", e.target.value)} style={select}>
        <option value="">All printers</option>
        {printers.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <select aria-label="Status" value={status} onChange={(e) => set("status", e.target.value)} style={select}>
        <option value="">Any status</option>
        {Object.entries(STATUS).map(([key, s]) => (
          <option key={key} value={key}>
            {s.label} ({counts[key] ?? 0})
          </option>
        ))}
      </select>
    </div>
  );
}

export default function PrintQueuePanel({
  rows,
  counts,
  printers,
  printerId,
  status,
  page,
  total,
  totalPages,
}: {
  rows: PrintJobRow[];
  counts: Record<string, number>;
  printers: { id: string; name: string }[];
  printerId: string;
  status: string;
  page: number;
  total: number;
  totalPages: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [router]);

  async function act(id: string, run: (id: string) => Promise<{ ok: true; message: string } | { ok: false; error: string }>) {
    setBusy(id);
    const result = await run(id);
    setBusy(null);
    if (result.ok) toast.success(result.message);
    else toast.error(result.error);
    router.refresh();
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <Link href="/settings/printers" aria-label="Back to Printers" style={{ width: 34, height: 34, borderRadius: 8, border: `1px solid ${COLORS.border}`, display: "flex", alignItems: "center", justifyContent: "center", color: COLORS.slate }}>
          <ChevronLeft size={16} strokeWidth={1.8} />
        </Link>
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: 0, fontFamily: FONTS.display, fontSize: 26, fontWeight: 700, letterSpacing: "-.015em" }}>Print queue</h1>
          <p style={{ margin: "2px 0 0", fontSize: 13.5, color: COLORS.slateMid }}>Every print, newest first. A print that fails stays here until it&apos;s retried, reprinted or cancelled.</p>
        </div>
        <Suspense fallback={null}>
          <Filters printers={printers} printerId={printerId} status={status} counts={counts} />
        </Suspense>
      </div>

      <section aria-label="Print jobs" style={{ background: "#fff", border: `1px solid ${COLORS.border}`, borderRadius: 12, overflow: "hidden" }}>
        {rows.length === 0 ? (
          <p data-empty style={{ margin: 0, padding: 24, fontSize: 13.5, color: COLORS.slateMid }}>
            No print jobs{status || printerId ? " match these filters" : " yet"}.
          </p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Queued", "Job", "Printer", "Status", "Tries", "", ""].map((h, i) => (
                  <th key={i} style={th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((job) => {
                const s = STATUS[job.status];
                return (
                  <tr key={job.id} data-job={job.id} data-job-status={job.status}>
                    <td style={{ ...td, fontFamily: FONTS.mono, fontSize: 12, whiteSpace: "nowrap" }}>
                      {time(job.createdAt)}
                      {job.printedAt && <span style={{ display: "block", color: COLORS.slateMid }}>printed {time(job.printedAt)}</span>}
                    </td>
                    <td style={td}>
                      <span style={{ fontWeight: 600 }}>{job.label}</span>
                      <span style={{ display: "block", fontSize: 12, color: COLORS.slateMid }}>
                        {TYPE[job.type] ?? job.type}
                        {job.copies > 1 ? ` · ${job.copies} copies` : ""}
                        {job.reprint ? " · REPRINT" : ""}
                        {job.by ? ` · ${job.by}` : ""}
                      </span>
                    </td>
                    <td style={td}>
                      {job.printer}
                      {job.reroutedFrom && <span style={{ display: "block", fontSize: 12, color: "#8a5a00" }}>rerouted from {job.reroutedFrom}</span>}
                    </td>
                    <td style={td}>
                      <span style={{ height: 22, padding: "0 9px", borderRadius: 11, background: s.bg, color: s.fg, fontSize: 11.5, fontWeight: 600, display: "inline-flex", alignItems: "center" }}>{s.label}</span>
                    </td>
                    <td style={{ ...td, fontFamily: FONTS.mono }}>{job.attempts}</td>
                    <td style={{ ...td, fontSize: 12.5, color: job.status === "FAILED" ? COLORS.danger : COLORS.slateMid, maxWidth: 320 }}>{job.error}</td>
                    <td style={{ ...td, whiteSpace: "nowrap", textAlign: "right" }}>
                      <span style={{ display: "inline-flex", gap: 6 }}>
                        {/* A drawer kick is never sent again from here (Open drawer needs its permission and a reason). */}
                        {job.type !== "DRAWER" && (job.status === "FAILED" || job.status === "CANCELLED") && (
                          <button type="button" aria-label={`Retry ${job.label}`} disabled={busy === job.id} onClick={() => void act(job.id, retryJob)} style={{ ...small, color: COLORS.tealDark }}>
                            Retry
                          </button>
                        )}
                        {job.type !== "DRAWER" && (job.status === "DONE" || job.status === "FAILED" || job.status === "CANCELLED") && (
                          <button type="button" aria-label={`Reprint ${job.label}`} disabled={busy === job.id} onClick={() => void act(job.id, reprintJob)} style={small}>
                            Reprint
                          </button>
                        )}
                        {job.status === "QUEUED" && (
                          <button type="button" aria-label={`Cancel ${job.label}`} disabled={busy === job.id} onClick={() => void act(job.id, cancelJob)} style={{ ...small, color: COLORS.danger }}>
                            Cancel
                          </button>
                        )}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", borderTop: `1px solid ${COLORS.border}`, fontSize: 13, color: COLORS.slateMid }}>
          <span>
            {total} {total === 1 ? "job" : "jobs"}
          </span>
          <span style={{ display: "flex", gap: 8 }}>
            {page > 1 && <Link href={`?${new URLSearchParams({ ...(printerId ? { printer: printerId } : {}), ...(status ? { status } : {}), page: String(page - 1) })}`}>← Newer</Link>}
            {page < totalPages && <Link href={`?${new URLSearchParams({ ...(printerId ? { printer: printerId } : {}), ...(status ? { status } : {}), page: String(page + 1) })}`}>Older →</Link>}
          </span>
        </div>
      </section>
    </div>
  );
}
