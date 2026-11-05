"use client";

import { useMemo, useState, type ChangeEvent } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import { ChevronLeft, ImageUp } from "lucide-react";
import { COLORS, FONTS } from "@/components/layout/theme";
import { removeLogo, saveLogo, saveTicketSettings } from "@/app/(dashboard)/settings/ticket-templates/actions";
import { LOGO_MAX_HEIGHT, LOGO_MAX_WIDTH, toRaster, type Raster } from "@/lib/hardware/raster";
import { SAMPLE_KOT, SAMPLE_PREBILL, SAMPLE_RECEIPT, SAMPLE_VOID_KOT } from "@/lib/hardware/sampleTickets";
import { QR_TEXT_MAX, TEMPLATE_TEXT_MAX } from "@/lib/hardware/ticketLimits";
import { lookFrom } from "@/lib/hardware/look";
import { renderKot, renderPrebill, renderReceipt, type RenderOptions } from "@/lib/hardware/tickets";
import TicketPreview from "./TicketPreview";

// Settings › Ticket templates: the look of the printed tickets, with the
// preview drawn from the very bytes a printer would get (the sample ticket,
// with the settings as they are on screen, saved or not).

type Form = { logo: boolean; header: string; footer: string; kitchenLarge: boolean; kotPrices: boolean; qr: boolean; qrText: string };
type Sample = "RECEIPT" | "PREBILL" | "KOT" | "VOID";
const SAMPLES: { key: Sample; label: string }[] = [
  { key: "RECEIPT", label: "Receipt" },
  { key: "PREBILL", label: "Pre-bill" },
  { key: "KOT", label: "KOT" },
  { key: "VOID", label: "VOID KOT" },
];

const card = { background: "#fff", border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 20, display: "flex", flexDirection: "column", gap: 16 } as const;
const label = { fontSize: 13, fontWeight: 600, color: COLORS.text } as const;
const textarea = { border: `1px solid ${COLORS.borderStrong}`, borderRadius: 8, padding: "10px 12px", fontSize: 13.5, fontFamily: FONTS.mono, resize: "vertical", outline: "none", minHeight: 84 } as const;
const input = { height: 40, border: `1px solid ${COLORS.borderStrong}`, borderRadius: 8, padding: "0 12px", fontSize: 13.5, outline: "none" } as const;
const small = { height: 34, padding: "0 12px", border: `1px solid ${COLORS.borderStrong}`, borderRadius: 8, background: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 } as const;

const fromBase64 = (data: string) => Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
const toBase64 = (bytes: Uint8Array) => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};

// An image file → at most 384 × 240 dots, 1-bit (dithered), in the browser.
function rasterise(file: File): Promise<Raster> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, LOGO_MAX_WIDTH / img.naturalWidth, LOGO_MAX_HEIGHT / img.naturalHeight);
      const width = Math.max(8, Math.round(img.naturalWidth * scale));
      const height = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("This browser can't read images."));
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      resolve(toRaster(ctx.getImageData(0, 0, width, height).data, width, height));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file isn't an image this browser can open."));
    };
    img.src = url;
  });
}

function Toggle({ checked, onChange, children, name }: { checked: boolean; onChange: (v: boolean) => void; children: string; name: string }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}>
      <input type="checkbox" aria-label={name} checked={checked} onChange={(e) => onChange(e.target.checked)} /> {children}
    </label>
  );
}

export default function TicketTemplatesPanel({ initial, logoImage }: { initial: Form; logoImage: { width: number; height: number; data: string } | null }) {
  const [form, setForm] = useState<Form>(initial);
  const [saved, setSaved] = useState<Form>(initial);
  const [logo, setLogo] = useState<Raster | null>(logoImage ? { width: logoImage.width, height: logoImage.height, data: fromBase64(logoImage.data) } : null);
  const [saving, setSaving] = useState(false);
  const [sample, setSample] = useState<Sample>("RECEIPT");
  const [paper, setPaper] = useState(80);
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);

  const bytes = useMemo(() => {
    const look = lookFrom({ ...form, logoImage: logo });
    const o: RenderOptions = { paperWidth: paper, codePage: "PC858", cut: "PARTIAL", reprint: null, reroutedFrom: null, look };
    try {
      if (sample === "RECEIPT") return renderReceipt(SAMPLE_RECEIPT, o);
      if (sample === "PREBILL") return renderPrebill(SAMPLE_PREBILL, o);
      return renderKot(sample === "VOID" ? SAMPLE_VOID_KOT : SAMPLE_KOT, o);
    } catch {
      return new Uint8Array();
    }
  }, [form, logo, sample, paper]);

  async function pickLogo(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const raster = await rasterise(file);
      const result = await saveLogo({ width: raster.width, height: raster.height, data: toBase64(raster.data) });
      if (!result.ok) return void toast.error(result.error);
      setLogo(raster);
      setForm((f) => ({ ...f, logo: true }));
      setSaved((f) => ({ ...f, logo: true }));
      toast.success(`Logo saved (${raster.width} × ${raster.height} dots).`);
    } catch (error) {
      toast.error((error as Error).message);
    }
  }

  async function dropLogo() {
    const result = await removeLogo();
    if (!result.ok) return void toast.error(result.error);
    setLogo(null);
    setForm((f) => ({ ...f, logo: false }));
    setSaved((f) => ({ ...f, logo: false }));
    toast.success("Logo removed.");
  }

  async function save() {
    setSaving(true);
    const result = await saveTicketSettings(form);
    setSaving(false);
    if (!result.ok) return void toast.error(result.error);
    setSaved(form);
    toast.success("Ticket templates saved — the next tickets print this way.");
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Link href="/settings/printers" aria-label="Back to Printers" style={{ width: 34, height: 34, borderRadius: 8, border: `1px solid ${COLORS.border}`, display: "flex", alignItems: "center", justifyContent: "center", color: COLORS.slate }}>
          <ChevronLeft size={16} strokeWidth={1.8} />
        </Link>
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: 0, fontFamily: FONTS.display, fontSize: 26, fontWeight: 700, letterSpacing: "-.015em" }}>Ticket templates</h1>
          <p style={{ margin: "2px 0 0", fontSize: 13.5, color: COLORS.slateMid }}>How receipts, pre-bills and kitchen tickets look on the thermal printers.</p>
        </div>
        <button type="button" onClick={() => void save()} disabled={!dirty || saving} style={{ height: 38, padding: "0 16px", border: "none", borderRadius: 8, background: dirty ? COLORS.teal : COLORS.slateLight, color: "#fff", fontSize: 13.5, fontWeight: 600, cursor: dirty ? "pointer" : "default" }}>
          {saving ? "Saving…" : "Save templates"}
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 20, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <section aria-label="Logo and header" style={card}>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Receipts and pre-bills</h2>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <Toggle name="Print the logo" checked={form.logo && !!logo} onChange={(v) => set("logo", v)}>
                Print the logo
              </Toggle>
              <label style={{ ...small, color: COLORS.tealDark }}>
                <ImageUp size={15} strokeWidth={1.8} /> {logo ? "Replace logo" : "Upload logo"}
                <input type="file" aria-label="Logo image" accept="image/*" onChange={(e) => void pickLogo(e)} style={{ display: "none" }} />
              </label>
              {logo && (
                <button type="button" onClick={() => void dropLogo()} style={{ ...small, color: COLORS.danger }}>
                  Remove logo
                </button>
              )}
              <span style={{ fontSize: 12.5, color: COLORS.slateMid }}>
                {logo ? `Turned to black and white once: ${logo.width} × ${logo.height} dots.` : "Any image; it's turned to black and white for the printer once, here."}
              </span>
            </div>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={label}>Header — the business name first, then address, phone…</span>
              <textarea aria-label="Header" value={form.header} maxLength={TEMPLATE_TEXT_MAX} rows={4} placeholder={"Mama Put Kitchen\n12 Allen Avenue, Ikeja\n0803 000 0000"} onChange={(e) => set("header", e.target.value)} style={textarea} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={label}>Footer</span>
              <textarea aria-label="Footer" value={form.footer} maxLength={TEMPLATE_TEXT_MAX} rows={3} placeholder={"Thank you for your purchase.\nOpen daily 8am – 10pm"} onChange={(e) => set("footer", e.target.value)} style={textarea} />
            </label>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <Toggle name="Print a QR code" checked={form.qr} onChange={(v) => set("qr", v)}>
                Print a QR code
              </Toggle>
              {form.qr && <input aria-label="QR code text" value={form.qrText} maxLength={QR_TEXT_MAX} placeholder="https://… (a review page, the menu, Wi-Fi details)" onChange={(e) => set("qrText", e.target.value)} style={input} />}
            </div>
          </section>

          <section aria-label="Kitchen tickets" style={card}>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Kitchen tickets (KOT)</h2>
            <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13.5 }}>
              <span style={label}>Font size</span>
              <select aria-label="Kitchen font size" value={form.kitchenLarge ? "large" : "normal"} onChange={(e) => set("kitchenLarge", e.target.value === "large")} style={{ ...input, background: "#fff" }}>
                <option value="normal">Normal</option>
                <option value="large">Large</option>
              </select>
            </label>
            <Toggle name="Show prices on KOT" checked={form.kotPrices} onChange={(v) => set("kotPrices", v)}>
              Show prices on kitchen tickets
            </Toggle>
          </section>
        </div>

        <section aria-label="Preview" style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "center" }}>
          <div role="radiogroup" aria-label="Sample" style={{ display: "flex", gap: 4, background: "#fff", border: `1px solid ${COLORS.border}`, borderRadius: 9, padding: 3 }}>
            {SAMPLES.map((s) => (
              <button key={s.key} type="button" role="radio" aria-checked={sample === s.key} onClick={() => setSample(s.key)} style={{ height: 30, padding: "0 12px", border: "none", borderRadius: 6, background: sample === s.key ? COLORS.teal : "transparent", color: sample === s.key ? "#fff" : COLORS.slate, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
                {s.label}
              </button>
            ))}
          </div>
          <div role="radiogroup" aria-label="Paper" style={{ display: "flex", gap: 6 }}>
            {[80, 58].map((w) => (
              <button key={w} type="button" role="radio" aria-checked={paper === w} onClick={() => setPaper(w)} style={{ ...small, height: 28, background: paper === w ? COLORS.tealTint : "#fff", color: paper === w ? COLORS.tealDark : COLORS.slate }}>
                {w} mm
              </button>
            ))}
          </div>
          <TicketPreview bytes={bytes} paper={paper} />
          <span style={{ fontSize: 12, color: COLORS.slateMid }}>Sample ticket · as printed on PC858</span>
        </section>
      </div>
    </div>
  );
}
