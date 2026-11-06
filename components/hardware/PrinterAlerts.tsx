"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import { Printer } from "lucide-react";
import { printerAlerts } from "@/lib/hardware/alertActions";
import { alertText, type PrinterAlert } from "@/lib/hardware/alertText";

// A small red badge per printer in trouble — "Kitchen printer offline
// (3 waiting)", "Receipt printer: 1 failed" — on the kitchen display and
// the POS, checked every 10 s. Admins (Manage Setting) can open the print
// queue from it, and are told a role has no printer ("No printer assigned
// for Bar. Set up." → Settings › Printers). Nothing shows while all is well.

const POLL_MS = 10_000;

export default function PrinterAlerts({ scope, dark = false, style: outer }: { scope: "kitchen" | "till"; dark?: boolean; style?: CSSProperties }) {
  const [alerts, setAlerts] = useState<PrinterAlert[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [missing, setMissing] = useState<string[]>([]);
  const poll = useCallback(async () => {
    const result = await printerAlerts(scope).catch(() => ({ ok: false as const }));
    if (result.ok) {
      setAlerts(result.alerts);
      setCanManage(result.canManage);
      setMissing(result.missing);
    }
  }, [scope]);
  useEffect(() => {
    const first = setTimeout(() => void poll(), 0);
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [poll]);

  if (alerts.length === 0 && missing.length === 0) return null;
  const style = {
    height: 28,
    padding: "0 10px",
    borderRadius: 14,
    background: dark ? "#8a1f33" : "#fcecef",
    color: dark ? "#fff" : "#b4233c",
    border: dark ? "1px solid #b4233c" : "1px solid #f5d3da",
    fontSize: 12.5,
    fontWeight: 700,
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    whiteSpace: "nowrap",
    textDecoration: "none",
  } as const;
  return (
    <span aria-live="polite" aria-label="Printer problems" style={{ display: "inline-flex", gap: 6, flexWrap: "wrap", ...outer }}>
      {alerts.map((a) =>
        canManage ? (
          <Link key={a.printer} href="/settings/print-queue" data-printer-alert={a.printer} style={style} title="Open the print queue">
            <Printer size={13} strokeWidth={2} /> {alertText(a)}
          </Link>
        ) : (
          <span key={a.printer} data-printer-alert={a.printer} style={style}>
            <Printer size={13} strokeWidth={2} /> {alertText(a)}
          </span>
        ),
      )}
      {missing.map((m) => (
        <Link key={m} href="/settings/printers" data-printer-missing={m} title="Set up printers" style={{ ...style, background: dark ? "#6b4a00" : "#fff4e0", color: dark ? "#fff" : "#8a5a00", border: dark ? "1px solid #8a5a00" : "1px solid #f3dfb5" }}>
          <Printer size={13} strokeWidth={2} /> {m}
        </Link>
      ))}
    </span>
  );
}
