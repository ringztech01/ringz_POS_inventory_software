"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { printerLights, type PrinterLight } from "@/lib/hardware/alertActions";
import { TOUCH } from "../../lib/theme";

const POLL_MS = 10_000;
const DOT = { ok: TOUCH.ok, fault: TOUCH.fault, none: TOUCH.muted } as const;

// The header's printer lights (Restaurant POS design): "● Kitchen ● Bar
// ● Receipt" — green when that printer is fine, red when it's in trouble
// (offline, out of paper, jobs failed), grey when there's none set up. The
// light's tooltip says which; admins can open the print queue (or the
// printers) from a red or grey one. Checked every 10 s.
export default function PrinterLights() {
  const [lights, setLights] = useState<PrinterLight[]>([]);
  const [canManage, setCanManage] = useState(false);
  const poll = useCallback(async () => {
    const result = await printerLights().catch(() => ({ ok: false as const }));
    if (result.ok) {
      setLights(result.lights);
      setCanManage(result.canManage);
    }
  }, []);
  useEffect(() => {
    const first = setTimeout(() => void poll(), 0);
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [poll]);

  return (
    <div aria-label="Printers" data-printer-lights style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 13, color: TOUCH.textDim, whiteSpace: "nowrap" }}>
      {lights.map((light) => {
        const content = (
          <>
            <span aria-hidden style={{ width: 8, height: 8, borderRadius: "50%", background: DOT[light.state], flexShrink: 0 }} />
            {light.label}
          </>
        );
        const style = { display: "flex", alignItems: "center", gap: 6, color: light.state === "fault" ? TOUCH.dangerText : TOUCH.textDim, textDecoration: "none" } as const;
        return canManage && light.state !== "ok" ? (
          <Link key={light.label} href={light.state === "fault" ? "/settings/print-queue" : "/settings/printers"} data-printer-light={light.state} title={light.detail} style={style}>
            {content}
          </Link>
        ) : (
          <span key={light.label} data-printer-light={light.state} title={light.detail} style={style}>
            {content}
          </span>
        );
      })}
    </div>
  );
}
