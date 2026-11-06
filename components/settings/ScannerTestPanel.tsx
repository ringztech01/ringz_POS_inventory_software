"use client";

import { useState } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import { ChevronLeft, MonitorSmartphone, ScanLine } from "lucide-react";
import { COLORS, FONTS } from "@/components/layout/theme";
import CameraScanButton from "@/components/hardware/CameraScanner";
import { useHasCamera, useScan, useScanEvents, useScanSettings, type ScanEvent } from "@/components/hardware/ScanProvider";
import { DEFAULT_SCAN, SCAN_LIMITS, suggestedMaxGap, type ScanSettings } from "@/lib/hardware/scan";

// Settings › Scanner test: scan something and see the code and its timing —
// every gap between characters — to tune this device's limits (kept in this
// browser). Scans here stay here (they don't open products).

const card = { background: "#fff", border: `1px solid ${COLORS.border}`, borderRadius: 12, overflow: "hidden" } as const;
const cardHead = { padding: "16px 20px", borderBottom: `1px solid ${COLORS.border}` } as const;
const small = { height: 34, padding: "0 14px", border: `1px solid ${COLORS.borderStrong}`, borderRadius: 8, background: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", color: COLORS.text } as const;
const primary = { ...small, border: "none", background: COLORS.teal, color: "#fff" } as const;
const time = (at: number) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(new Date(at));

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: COLORS.slateMid }}>{label}</span>
      <span style={{ fontFamily: FONTS.mono, fontSize: 18, fontWeight: 600 }}>{value}</span>
    </div>
  );
}

function Limits({ settings, onSave, suggestion }: { settings: ScanSettings; onSave: (s: ScanSettings | null) => void; suggestion: number | null }) {
  // Starts from the saved limits (remounted when they change — the key below).
  const [draft, setDraft] = useState(settings);
  const dirty = draft.maxGapMs !== settings.maxGapMs || draft.minLength !== settings.minLength;
  const slider = (key: keyof ScanSettings, label: string, unit: string, hint: string) => (
    <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13.5, fontWeight: 600 }}>
      <span style={{ display: "flex", justifyContent: "space-between" }}>
        {label}
        <span data-limit={key} style={{ fontFamily: FONTS.mono }}>
          {draft[key]} {unit}
        </span>
      </span>
      <input type="range" aria-label={label} min={SCAN_LIMITS[key][0]} max={SCAN_LIMITS[key][1]} value={draft[key]} onChange={(e) => setDraft((d) => ({ ...d, [key]: Number(e.target.value) }))} />
      <span style={{ fontSize: 12.5, fontWeight: 400, color: COLORS.slateMid }}>{hint}</span>
    </label>
  );
  return (
    <section aria-label="Scanner limits" style={card}>
      <div style={cardHead}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>This device&apos;s limits</h2>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: COLORS.slateMid }}>Saved in this browser only — each till keeps its own.</p>
      </div>
      <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 18 }}>
        {slider("maxGapMs", "Slowest gap between characters", "ms", "Faster than this is a scanner; slower is a person typing. Most scanners need 10–40 ms; people type at 100 ms or more.")}
        {slider("minLength", "Shortest code", "characters", "Shorter runs are ignored, so a quick key press never counts as a scan.")}
        {suggestion !== null && suggestion !== draft.maxGapMs && (
          <p data-suggestion style={{ margin: 0, fontSize: 13, color: COLORS.tealDark }}>
            If that last one was your scanner, a limit of {suggestion} ms suits it.{" "}
            <button type="button" onClick={() => setDraft((d) => ({ ...d, maxGapMs: suggestion }))} style={{ border: "none", background: "none", padding: 0, color: COLORS.tealDark, fontWeight: 700, textDecoration: "underline", cursor: "pointer", fontSize: 13 }}>
              Use {suggestion} ms
            </button>
          </p>
        )}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button type="button" style={small} onClick={() => { onSave(null); toast.success("Back to the default limits."); }}>
            Reset to default ({DEFAULT_SCAN.maxGapMs} ms, {DEFAULT_SCAN.minLength})
          </button>
          <button type="button" style={{ ...primary, opacity: dirty ? 1 : 0.5, cursor: dirty ? "pointer" : "default" }} disabled={!dirty} onClick={() => { onSave(draft); toast.success("Scanner limits saved on this device."); }}>
            Save
          </button>
        </div>
      </div>
    </section>
  );
}

export default function ScannerTestPanel() {
  const [settings, save] = useScanSettings();
  const [events, setEvents] = useState<ScanEvent[]>([]);
  const hasCamera = useHasCamera();
  // Scans on this page stay here.
  useScan(() => {});
  useScanEvents((event) => setEvents((all) => [event, ...all].slice(0, 10)));
  const last = events[0] ?? null;
  const attempt = last?.attempt ?? null;
  const lastScannerAttempt = events.find((e) => e.attempt)?.attempt ?? null;
  const suggestion = lastScannerAttempt && lastScannerAttempt.code.length >= 2 ? suggestedMaxGap(lastScannerAttempt.slowestGapMs) : null;
  const tallest = attempt ? Math.max(settings.maxGapMs, ...attempt.gaps) : 1;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 980 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Link href="/settings" aria-label="Back to Settings" style={{ width: 34, height: 34, borderRadius: 8, border: `1px solid ${COLORS.border}`, display: "flex", alignItems: "center", justifyContent: "center", color: COLORS.slate }}>
          <ChevronLeft size={16} strokeWidth={1.8} />
        </Link>
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: 0, fontFamily: FONTS.display, fontSize: 26, fontWeight: 700, letterSpacing: "-.015em" }}>Scanner test</h1>
          <p style={{ margin: "2px 0 0", fontSize: 13.5, color: COLORS.slateMid }}>Barcode scanners work as keyboards — no setup. Scan any barcode here (with no text box selected) to see the code and how fast it arrived.</p>
        </div>
      </div>

      <section aria-label="Last scan" style={card}>
        <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 18 }}>
          {!last ? (
            <div data-waiting style={{ display: "flex", alignItems: "center", gap: 14, color: COLORS.slateMid, fontSize: 15 }}>
              <ScanLine size={28} strokeWidth={1.5} /> Waiting for a scan…
            </div>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                <span data-last-code style={{ fontFamily: FONTS.mono, fontSize: 30, fontWeight: 700, wordBreak: "break-all" }}>
                  {last.code || "—"}
                </span>
                <span
                  data-last-result={last.source === "camera" ? "camera" : attempt?.accepted ? "scan" : "typing"}
                  style={{ height: 26, padding: "0 11px", borderRadius: 13, display: "inline-flex", alignItems: "center", fontSize: 12.5, fontWeight: 700, background: last.source === "camera" || attempt?.accepted ? "#eff8f6" : "#fcecef", color: last.source === "camera" || attempt?.accepted ? "#0a6355" : "#b4233c" }}
                >
                  {last.source === "camera" ? "Read by the camera" : attempt?.accepted ? "Scan" : "Not a scan"}
                </span>
              </div>
              {attempt && !attempt.accepted && <p data-reason style={{ margin: 0, fontSize: 13.5, color: "#b4233c" }}>{attempt.reason}</p>}
              {attempt && (
                <>
                  <div style={{ display: "flex", gap: 36, flexWrap: "wrap" }}>
                    <Stat label="Characters" value={String(attempt.code.length)} />
                    <Stat label="Total time" value={`${attempt.durationMs} ms`} />
                    <Stat label="Slowest gap" value={`${attempt.slowestGapMs} ms`} />
                    <Stat label="Average gap" value={`${attempt.averageGapMs} ms`} />
                  </div>
                  <div aria-label="Gaps between characters" style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 64, borderBottom: `1px solid ${COLORS.border}`, position: "relative" }}>
                    <div title={`Limit ${settings.maxGapMs} ms`} style={{ position: "absolute", left: 0, right: 0, bottom: `${(settings.maxGapMs / tallest) * 64}px`, borderTop: `1px dashed ${COLORS.danger}` }} />
                    {attempt.gaps.map((g, i) => (
                      <div key={i} title={`${g} ms`} style={{ flex: "1 1 0", maxWidth: 18, height: `${Math.max(2, (g / tallest) * 64)}px`, background: g > settings.maxGapMs ? COLORS.danger : COLORS.teal, borderRadius: "3px 3px 0 0" }} />
                    ))}
                  </div>
                  <span style={{ fontSize: 12.5, color: COLORS.slateMid }}>Each bar is the time before one character (the last: before Enter). The dashed line is this device&apos;s limit, {settings.maxGapMs} ms.</span>
                </>
              )}
            </>
          )}
        </div>
      </section>

      <Limits key={`${settings.maxGapMs}:${settings.minLength}`} settings={settings} onSave={save} suggestion={suggestion} />

      <section aria-label="Camera and display" style={card}>
        <div style={{ padding: 20, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          {hasCamera ? (
            <CameraScanButton
              render={(open) => (
                <button type="button" onClick={open} style={{ ...small, display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <ScanLine size={15} strokeWidth={1.7} /> Test the camera
                </button>
              )}
            />
          ) : (
            <span style={{ fontSize: 13, color: COLORS.slateMid }}>No camera on this device — tablets and phones get a camera scan button on the POS and in the top bar.</span>
          )}
          <a href="/customer-display" target="_blank" rel="noreferrer" style={{ ...small, display: "inline-flex", alignItems: "center", gap: 8, textDecoration: "none", marginLeft: "auto" }}>
            <MonitorSmartphone size={15} strokeWidth={1.7} /> Open the customer display
          </a>
        </div>
      </section>

      {events.length > 0 && (
        <section aria-label="Recent scans" style={card}>
          <div style={cardHead}>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Recent</h2>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <tbody>
              {events.map((e, i) => (
                <tr key={`${e.at}-${i}`} data-recent={e.attempt ? (e.attempt.accepted ? "scan" : "typing") : "camera"}>
                  <td style={{ padding: "8px 20px", borderTop: i ? `1px solid ${COLORS.border}` : "none", fontFamily: FONTS.mono, color: COLORS.slateMid, width: 90 }}>{time(e.at)}</td>
                  <td style={{ padding: "8px 12px", borderTop: i ? `1px solid ${COLORS.border}` : "none", fontFamily: FONTS.mono, wordBreak: "break-all" }}>{e.code}</td>
                  <td style={{ padding: "8px 20px", borderTop: i ? `1px solid ${COLORS.border}` : "none", textAlign: "right", color: COLORS.slateMid, whiteSpace: "nowrap" }}>
                    {e.attempt ? `${e.attempt.accepted ? "Scan" : "Not a scan"} · slowest ${e.attempt.slowestGapMs} ms` : "Camera"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
