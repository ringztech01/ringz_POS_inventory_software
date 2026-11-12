"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { ArrowLeft, Printer } from "lucide-react";
import { formatNaira } from "@/lib/format";
import { expectedCash, parseCash, variance, varianceLabel } from "../../lib/cashUp";
import { formatAppTime } from "../../lib/time";
import { TOUCH } from "../../lib/theme";
import { minus, zReport, type TillSummary } from "../../lib/zReport";
import { closeTill, openTill, printZReport } from "../../server/actions/till";
import type { TillScreen } from "../../server/services/till";
import TouchButton from "./TouchButton";

const UNREACHABLE = "Couldn't reach the server. Check the connection and try again.";
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "00", "0", "⌫"];
const QUICK_FLOATS = ["0", "5000", "10000", "20000"];
const money = (v: string) => formatNaira(v || "0");
const when = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short" })} ${formatAppTime(d)}`;
};

// Cash-up for this till (Part 6f Step 7b; the touch frame). Not open: the
// float on a number pad, then Open till. Open: what it's taken so far and
// what should be in the drawer; Close till → count the cash → the variance
// as you type → Close → the Z-report, on screen and (Print) on this till's
// receipt printer. Its last five cash-ups on the right, each reprintable.
export default function CashUpScreen({ screen, back }: { screen: TillScreen | null; back: string }) {
  const router = useRouter();
  const [busy, startBusy] = useTransition();
  const [amount, setAmount] = useState("");
  const [counting, setCounting] = useState(false);
  const [note, setNote] = useState("");
  const [shown, setShown] = useState<TillSummary | null>(null);

  const open = screen?.open ?? null;
  const live = useMemo(() => {
    if (!open || !counting) return null;
    const counted = parseCash(amount || "0");
    const expected = expectedCash(open.figures);
    return counted ? { expected, v: variance(counted, expected) } : null;
  }, [open, counting, amount]);

  const press = (key: string) => setAmount((a) => (key === "⌫" ? a.slice(0, -1) : (a + key).replace(/^0+(?=\d)/, "").slice(0, 9)));
  const run = <T extends { ok: boolean; error?: string }>(work: () => Promise<T>, done: (r: T & { ok: true }) => void) =>
    startBusy(async () => {
      const r = await work().catch(() => ({ ok: false, error: UNREACHABLE }) as unknown as T);
      if (!r.ok) return void toast.error(r.error ?? "Something went wrong.");
      done(r as T & { ok: true });
      router.refresh();
    });

  if (!screen)
    return (
      <Frame back={back} title="Cash-up">
        <p style={{ fontSize: 18, color: TOUCH.textDim }}>This device isn&apos;t registered yet. Reload the page.</p>
      </Frame>
    );

  const print = (s: TillSummary) =>
    run(
      () => printZReport(s.id),
      (r) => toast.success(`${r.reprint ? "Z-report reprinted" : "Z-report sent"} to ${r.printer}.`),
    );

  let main: React.ReactNode;
  if (shown) {
    main = <ZView till={screen.till} summary={shown} printer={screen.printer} busy={busy} onPrint={() => print(shown)} onDone={() => setShown(null)} />;
  } else if (!open) {
    main = (
      <Panel title="Open the till" hint="The cash in the drawer to start with: the float.">
        <Amount label="Float" value={amount} />
        <div style={{ display: "flex", gap: 8 }}>
          {QUICK_FLOATS.map((q) => (
            <TouchButton key={q} data-quick-float={q} background={TOUCH.key} onClick={() => setAmount(q)} style={{ flex: 1, height: 48, fontSize: 15, fontWeight: 700 }}>
              {money(q)}
            </TouchButton>
          ))}
        </div>
        <Pad onKey={press} onClear={() => setAmount("")} />
        <TouchButton data-open-till background={TOUCH.teal} color="#fff" disabled={busy || amount === ""} onClick={() => run(() => openTill({ float: amount }), () => (setAmount(""), toast.success("Till open.")))} style={{ height: 64, fontSize: 20, fontWeight: 800, opacity: busy || amount === "" ? 0.5 : 1 }}>
          {busy ? "Opening…" : `Open till · ${money(amount || "0")}`}
        </TouchButton>
      </Panel>
    );
  } else if (!counting) {
    const f = open.figures;
    main = (
      <Panel title="The till is open" hint={`Opened ${when(open.openedAt)} by ${open.openedBy}.`}>
        <Rows
          data="open"
          rows={[
            ["Float", money(f.float)],
            ["Cash taken", money(f.cashSales)],
            ["Cash tips", money(f.cashTips)],
            ["Cash refunds", minus(f.cashRefunds)],
          ]}
          total={["Should be in the drawer", money(f.expected)]}
        />
        <Rows data="methods" rows={f.byMethod.map((m) => [`${m.label} · ${m.count}`, money(m.amount)] as [string, string])} />
        <TouchButton data-start-count background={TOUCH.pay} color="#fff" onClick={() => (setAmount(""), setCounting(true))} style={{ height: 64, fontSize: 20, fontWeight: 800 }}>
          Close till — count the cash
        </TouchButton>
      </Panel>
    );
  } else {
    main = (
      <Panel title="Count the cash" hint="Everything in the drawer, float included.">
        <Amount label="Counted" value={amount} />
        <div data-live-variance style={{ display: "flex", justifyContent: "space-between", fontSize: 17, fontWeight: 700, color: live && !live.v.isZero() ? (live.v.isNegative() ? TOUCH.dangerText : "#F2B233") : TOUCH.textDim }}>
          <span>Expected {money(expectedCash(open.figures).toFixed(2))}</span>
          <span>{live ? varianceLabel(live.v) : "—"}</span>
        </div>
        <Pad onKey={press} onClear={() => setAmount("")} />
        <input
          aria-label="Note (optional)"
          data-close-note
          value={note}
          maxLength={200}
          placeholder="Note (optional) — e.g. ₦500 paid out for ice"
          onChange={(e) => setNote(e.target.value)}
          style={{ height: 48, borderRadius: TOUCH.radius, border: "none", background: TOUCH.key, color: TOUCH.text, padding: "0 14px", fontSize: 16 }}
        />
        <div style={{ display: "flex", gap: 10 }}>
          <TouchButton data-cancel-count background={TOUCH.key} disabled={busy} onClick={() => setCounting(false)} style={{ height: 64, padding: "0 22px", fontSize: 18, fontWeight: 700 }}>
            Back
          </TouchButton>
          <TouchButton
            data-close-till
            background={TOUCH.teal}
            color="#fff"
            disabled={busy || amount === ""}
            onClick={() =>
              run(
                () => closeTill({ sessionId: open.id, counted: amount, note }),
                (r) => {
                  setCounting(false);
                  setAmount("");
                  setNote("");
                  setShown(r.summary);
                },
              )
            }
            style={{ flex: 1, height: 64, fontSize: 20, fontWeight: 800, opacity: busy || amount === "" ? 0.5 : 1 }}
          >
            {busy ? "Closing…" : "Close till · see the Z-report"}
          </TouchButton>
        </div>
      </Panel>
    );
  }

  return (
    <Frame back={back} title={`Cash-up · ${screen.till}`}>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.3fr) minmax(0, 1fr)", gap: 18, minHeight: 0 }}>
        <div style={{ minHeight: 0, overflowY: "auto", scrollbarWidth: "thin", paddingRight: 6 }}>{main}</div>
        <section aria-label="Last cash-ups" data-recent style={{ display: "flex", flexDirection: "column", gap: 8, minHeight: 0, overflowY: "auto" }}>
          <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".08em", color: TOUCH.muted }}>LAST CASH-UPS ON THIS TILL</span>
          {screen.recent.length === 0 ? (
            <span style={{ fontSize: 15, color: TOUCH.textDim }}>None yet.</span>
          ) : (
            screen.recent.map((r) => (
              <TouchButton key={r.id} data-recent-cashup={r.id} background={TOUCH.key} onClick={() => setShown(r)} style={{ padding: "10px 14px", display: "flex", flexDirection: "column", alignItems: "stretch", gap: 4, textAlign: "left" }}>
                <span style={{ display: "flex", justifyContent: "space-between", fontSize: 15, fontWeight: 700 }}>
                  <span>{when(r.closedAt ?? r.openedAt)}</span>
                  <span style={{ color: r.variance && Number(r.variance) < 0 ? TOUCH.dangerText : TOUCH.text }}>{r.result}</span>
                </span>
                <span style={{ fontSize: 13, color: TOUCH.textDim }}>
                  {r.closedBy} · expected {money(r.figures.expected)} · counted {money(r.counted ?? "0")}
                </span>
              </TouchButton>
            ))
          )}
        </section>
      </div>
    </Frame>
  );
}

function Frame({ back, title, children }: { back: string; title: string; children: React.ReactNode }) {
  const router = useRouter();
  return (
    <div data-cash-up style={{ position: "fixed", inset: 0, zIndex: 50, background: TOUCH.frame, color: TOUCH.text, display: "grid", gridTemplateRows: "60px minmax(0,1fr)", lineHeight: "normal" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 12, padding: "0 14px", background: TOUCH.header, borderBottom: `1px solid ${TOUCH.line}` }}>
        <TouchButton data-cash-up-back aria-label="Back" background={TOUCH.key} onClick={() => router.push(back)} style={{ height: 42, padding: "0 14px", display: "flex", alignItems: "center", gap: 6, fontSize: 15, fontWeight: 700 }}>
          <ArrowLeft size={17} /> Back
        </TouchButton>
        <h1 style={{ margin: 0, fontFamily: TOUCH.display, fontSize: 22, fontWeight: 700 }}>{title}</h1>
      </header>
      <div style={{ padding: 18, minHeight: 0, overflow: "hidden", display: "grid" }}>{children}</div>
    </div>
  );
}

function Panel({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 620 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <h2 data-cash-up-title style={{ margin: 0, fontFamily: TOUCH.display, fontSize: 26, fontWeight: 700 }}>
          {title}
        </h2>
        <span style={{ fontSize: 15, color: TOUCH.textDim }}>{hint}</span>
      </div>
      {children}
    </section>
  );
}

function Amount({ label, value }: { label: string; value: string }) {
  return (
    <div data-amount style={{ background: TOUCH.check, color: TOUCH.ink, borderRadius: TOUCH.radius, padding: "10px 16px", display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
      <span style={{ fontSize: 15, fontWeight: 700, color: TOUCH.inkDim }}>{label}</span>
      <span style={{ fontFamily: TOUCH.display, fontSize: 34, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{money(value || "0")}</span>
    </div>
  );
}

function Pad({ onKey, onClear }: { onKey: (k: string) => void; onClear: () => void }) {
  return (
    <div role="group" aria-label="Number pad" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gridAutoRows: 58, gap: 8 }}>
      {KEYS.map((k) => (
        <TouchButton key={k} data-cash-key={k} background={TOUCH.pinKey} onClick={() => onKey(k)} style={{ fontFamily: TOUCH.display, fontSize: 24, fontWeight: 700 }}>
          {k}
        </TouchButton>
      ))}
      <TouchButton data-cash-key="clear" background={TOUCH.key} color={TOUCH.textDim} onClick={onClear} style={{ gridColumn: "span 3", fontSize: 15, fontWeight: 700 }}>
        Clear
      </TouchButton>
    </div>
  );
}

function Rows({ rows, total, data }: { rows: [string, string][]; total?: [string, string]; data: string }) {
  return (
    <div data-rows={data} style={{ background: TOUCH.key, borderRadius: TOUCH.radius, padding: "8px 14px", display: "flex", flexDirection: "column" }}>
      {rows.map(([label, value]) => (
        <div key={label} data-row={label} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 16 }}>
          <span style={{ color: TOUCH.textDim }}>{label}</span>
          <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{value}</span>
        </div>
      ))}
      {total && (
        <div data-row={total[0]} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0 4px", marginTop: 4, borderTop: `1px solid ${TOUCH.line}`, fontSize: 18, fontWeight: 800 }}>
          <span>{total[0]}</span>
          <span style={{ fontVariantNumeric: "tabular-nums" }}>{total[1]}</span>
        </div>
      )}
    </div>
  );
}

// The Z-report as it prints (lib/zReport), with Print.
function ZView({ till, summary, printer, busy, onPrint, onDone }: { till: string; summary: TillSummary; printer: string | null; busy: boolean; onPrint: () => void; onDone: () => void }) {
  const z = zReport(till, summary);
  const short = summary.variance !== null && Number(summary.variance) < 0;
  return (
    <Panel title="Z-report" hint={`${z.till} · opened ${when(z.openedAt)} by ${z.openedBy} · closed ${when(z.closedAt)} by ${z.closedBy}`}>
      <div data-z-result style={{ fontFamily: TOUCH.display, fontSize: 30, fontWeight: 800, color: short ? TOUCH.dangerText : summary.variance === "0.00" ? TOUCH.ok : "#F2B233" }}>
        {z.result}
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        <TouchButton data-z-print background={TOUCH.key} disabled={busy || !printer} onClick={onPrint} style={{ height: 60, padding: "0 20px", display: "flex", alignItems: "center", gap: 8, fontSize: 17, fontWeight: 700, opacity: !printer ? 0.5 : 1 }}>
          <Printer size={18} /> {printer ? (summary.zPrinted ? "Reprint" : "Print Z-report") : "No receipt printer"}
        </TouchButton>
        <TouchButton data-z-done background={TOUCH.teal} color="#fff" onClick={onDone} style={{ flex: 1, height: 60, fontSize: 18, fontWeight: 800 }}>
          Done
        </TouchButton>
      </div>
      {z.sections.map((section) => (
        <div key={section.heading} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".08em", color: TOUCH.muted }}>{section.heading.toUpperCase()}</span>
          <Rows data={`z-${section.heading}`} rows={section.rows} />
        </div>
      ))}
      {z.note && <span style={{ fontSize: 15, color: TOUCH.textDim }}>Note: {z.note}</span>}
    </Panel>
  );
}
