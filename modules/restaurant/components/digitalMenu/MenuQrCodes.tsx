"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { AlertTriangle, BellRing, Download, Palette, Pencil, Plus, Printer, RefreshCw, Trash2, Wifi } from "lucide-react";
import ConfirmDeleteModal from "@/components/ui/ConfirmDeleteModal";
import { COLORS, FONTS } from "@/components/layout/theme";
import type { AddressChoice } from "../../lib/menuAddress";
import { QR_POINT_NAME_MAX, QR_POINT_TYPE_LABELS, QR_POINT_TYPES, WIFI_MAX, type MenuDesignChoice } from "../../schemas/menuQr";
import { saveServiceButtonsAction } from "../../server/actions/tableRequests";
import GuestOrderingCard, { type GuestOrderingView } from "./GuestOrderingCard";
import { addQrPointAction, removeQrPointAction, renameQrPointAction, rotateMenuQrAction, saveMenuAddressAction, saveMenuDesignAction, saveMenuWifiAction, type MenuQrAnswer } from "../../server/actions/menuQr";

// Digital menu › QR codes (Part 8 Step 2): the address the codes open, the
// Wi-Fi printed on the cards, the menu's look (Showcase or Classic), the guest buttons on a table's menu (Call
// waiter / Request bill, Step 6), every table's and QR point's code with Print,
// Download PNG and Rotate, and the QR points themselves.

export type QrRowView = {
  kind: "table" | "point";
  id: string;
  title: string;
  subtitle: string;
  rotatedAt: string | null;
  // The code (made with the saved address); none until one is saved.
  thumb: string | null;
  orderType?: "TAKEAWAY" | "BAR_TAB";
};

type Props = {
  address: string | null;
  choices: AddressChoice[];
  wifiName: string;
  wifiPassword: string;
  design: MenuDesignChoice;
  serviceButtons: { callWaiter: boolean; requestBill: boolean };
  ordering: GuestOrderingView;
  tables: QrRowView[];
  points: QrRowView[];
  reportsPrinter: string | null;
};

// Amber: a step still to do (no theme colour for it).
const AMBER = { fg: "#92400e", bg: "#fffbeb", border: "#fcd34d" };
const field = { height: 38, border: `1px solid ${COLORS.borderStrong}`, borderRadius: 8, padding: "0 10px", fontSize: 13.5, background: "#fff", color: COLORS.ink } as const;
const card = { background: "#fff", border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 22, display: "flex", flexDirection: "column", gap: 12 } as const;
const OFFLINE = "Couldn't reach the server. Check the connection and try again.";

async function run(action: () => Promise<MenuQrAnswer>, success: string): Promise<boolean> {
  try {
    const result = await action();
    if (result.ok) {
      toast.success(success);
      return true;
    }
    toast.error(result.error);
  } catch {
    toast.error(OFFLINE);
  }
  return false;
}

function Button({ children, onClick, href, download, disabled, tone = "plain", title, data }: { children: ReactNode; onClick?: () => void; href?: string; download?: boolean; disabled?: boolean; tone?: "plain" | "primary" | "danger"; title?: string; data?: Record<string, string> }) {
  const colours = tone === "primary" ? { bg: COLORS.teal, fg: "#fff", border: COLORS.teal } : tone === "danger" ? { bg: "#fff", fg: COLORS.danger, border: COLORS.dangerBorder } : { bg: "#fff", fg: COLORS.text, border: COLORS.borderStrong };
  const style = {
    height: 34,
    padding: "0 12px",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    borderRadius: 8,
    border: `1px solid ${disabled ? COLORS.border : colours.border}`,
    background: disabled ? COLORS.bgApp : colours.bg,
    color: disabled ? COLORS.slateLight : colours.fg,
    fontSize: 13,
    fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    textDecoration: "none",
    whiteSpace: "nowrap" as const,
  };
  const dataAttrs = Object.fromEntries(Object.entries(data ?? {}).map(([k, v]) => [`data-${k}`, v]));
  if (href && !disabled) {
    return (
      <a href={href} target={download ? undefined : "_blank"} rel="noreferrer" download={download || undefined} title={title} style={style} {...dataAttrs}>
        {children}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title} style={style} {...dataAttrs}>
      {children}
    </button>
  );
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "Never");
const cardHref = (row: QrRowView) => `/restaurant/menu-cards?${row.kind}=${encodeURIComponent(row.id)}`;
const pngHref = (row: QrRowView) => `/restaurant/digital-menu/qr-codes/card/${row.kind}/${encodeURIComponent(row.id)}`;

// An on/off switch that saves straight away (40×22, teal when on).
function Switch({ on, label, help, disabled, onChange, data }: { on: boolean; label: string; help: string; disabled: boolean; onChange: (on: boolean) => void; data: string }) {
  return (
    <label style={{ display: "flex", gap: 12, alignItems: "flex-start", cursor: disabled ? "default" : "pointer" }}>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        data-service-switch={data}
        disabled={disabled}
        onClick={() => onChange(!on)}
        style={{ width: 40, height: 22, flexShrink: 0, marginTop: 1, borderRadius: 11, border: "none", padding: 2, background: on ? COLORS.teal : COLORS.borderStrong, cursor: disabled ? "default" : "pointer", display: "flex", justifyContent: on ? "flex-end" : "flex-start", opacity: disabled ? 0.6 : 1 }}
      >
        <span style={{ width: 18, height: 18, borderRadius: 9, background: "#fff", display: "block" }} />
      </button>
      <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ fontSize: 13.5, fontWeight: 600, color: COLORS.ink }}>{label}</span>
        <span style={{ fontSize: 12.5, color: COLORS.slateMid }}>{help}</span>
      </span>
    </label>
  );
}

// The two looks, each with a small picture of itself.
const DESIGNS: { value: MenuDesignChoice; name: string; help: string; swatch: [string, string, string] }[] = [
  { value: "SHOWCASE", name: "Showcase", help: "Dark and warm, big round dish photos, the chef's signatures to swipe, 360° and 3D up front. The default.", swatch: ["#14100D", "#F2A93B", "#F5EDE1"] },
  { value: "CLASSIC", name: "Classic", help: "Light and plain in the menu's accent colour, system fonts: the lightest on old phones.", swatch: ["#fafbfb", "#0f7d6a", "#171b1c"] },
];

function DesignSwatch({ swatch: [bg, accent, ink] }: { swatch: [string, string, string] }) {
  return (
    <span aria-hidden style={{ width: 54, height: 72, flexShrink: 0, borderRadius: 8, background: bg, border: `1px solid ${COLORS.border}`, padding: 6, display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ height: 6, width: "70%", borderRadius: 3, background: ink, opacity: 0.85 }} />
      <span style={{ height: 14, borderRadius: 7, background: accent }} />
      <span style={{ flex: 1, borderRadius: 4, background: ink, opacity: 0.12 }} />
      <span style={{ flex: 1, borderRadius: 4, background: ink, opacity: 0.12 }} />
    </span>
  );
}

export default function MenuQrCodes({ address, choices, wifiName, wifiPassword, design, serviceButtons, ordering, tables, points, reportsPrinter }: Props) {
  const router = useRouter();
  const [typed, setTyped] = useState(address ?? choices.find((c) => c.kind === "ip")?.url ?? "");
  const [wifi, setWifi] = useState({ name: wifiName, password: wifiPassword });
  const [busy, setBusy] = useState<string | null>(null);
  const [rotating, setRotating] = useState<QrRowView | null>(null);
  const [removing, setRemoving] = useState<QrRowView | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [newPoint, setNewPoint] = useState<{ name: string; orderType: (typeof QR_POINT_TYPES)[number] }>({ name: "", orderType: "TAKEAWAY" });
  const ready = !!address;
  const printHint = reportsPrinter ? `Opens the print dialog: pick “${reportsPrinter}” (the Reports printer)` : "Opens the print dialog (no Reports printer is set in Settings › Printers: pick any A4 printer)";
  const blocked = "Save the menu's address first";

  async function act(key: string, action: () => Promise<MenuQrAnswer>, success: string, after?: () => void) {
    setBusy(key);
    const ok = await run(action, success);
    setBusy(null);
    if (ok) {
      after?.();
      router.refresh();
    }
  }

  const row = (r: QrRowView) => {
    const editing = renaming?.id === r.id && r.kind === "point";
    return (
      <div key={`${r.kind}-${r.id}`} data-qr-row={`${r.kind}:${r.title}`} style={{ display: "grid", gridTemplateColumns: "64px 1fr auto", gap: 14, alignItems: "center", padding: "12px 0", borderTop: `1px solid ${COLORS.border}` }}>
        <div aria-hidden style={{ width: 64, height: 64, borderRadius: 8, border: `1px solid ${COLORS.border}`, background: "#fff", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {r.thumb ? <div className="qr-thumb" style={{ width: 60, height: 60 }} dangerouslySetInnerHTML={{ __html: r.thumb }} /> : <span style={{ fontSize: 10, color: COLORS.slateLight }}>No code</span>}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
          {editing ? (
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input aria-label="Point name" data-point-rename value={renaming.name} maxLength={QR_POINT_NAME_MAX} autoFocus onChange={(e) => setRenaming({ id: r.id, name: e.target.value })} style={{ ...field, width: 220 }} />
              <Button tone="primary" disabled={busy !== null} onClick={() => act(`rename-${r.id}`, () => renameQrPointAction({ id: r.id, name: renaming.name }), "QR point renamed.", () => setRenaming(null))} data={{ "point-rename-save": "" }}>
                Save
              </Button>
              <Button onClick={() => setRenaming(null)}>Cancel</Button>
            </div>
          ) : (
            <span style={{ fontSize: 15, fontWeight: 600, color: COLORS.ink }}>{r.kind === "table" ? `Table ${r.title}` : r.title}</span>
          )}
          <span style={{ fontSize: 12.5, color: COLORS.slateMid }}>
            {r.subtitle} · Code last changed: <span data-qr-rotated>{when(r.rotatedAt)}</span>
          </span>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <Button href={cardHref(r)} disabled={!ready} title={ready ? printHint : blocked} data={{ "qr-print": r.id }}>
            <Printer size={15} strokeWidth={1.8} /> Print
          </Button>
          <Button href={pngHref(r)} download disabled={!ready} title={ready ? "Download this card as a PNG image" : blocked} data={{ "qr-png": r.id }}>
            <Download size={15} strokeWidth={1.8} /> PNG
          </Button>
          <Button onClick={() => setRotating(r)} disabled={busy !== null} title="Give this code a new link; the printed one stops working" data={{ "qr-rotate": r.id }}>
            <RefreshCw size={15} strokeWidth={1.8} /> Rotate
          </Button>
          {r.kind === "point" && !editing && (
            <>
              <Button onClick={() => setRenaming({ id: r.id, name: r.title })} title="Rename this point" data={{ "point-rename": r.id }}>
                <Pencil size={15} strokeWidth={1.8} />
              </Button>
              <Button tone="danger" onClick={() => setRemoving(r)} title="Remove this point" data={{ "point-remove": r.id }}>
                <Trash2 size={15} strokeWidth={1.8} />
              </Button>
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <div data-menu-qr style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 980 }}>
      <style>{`.qr-thumb svg { width: 100%; height: 100%; display: block; }`}</style>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <h1 style={{ margin: 0, fontFamily: FONTS.display, fontSize: 24, fontWeight: 600 }}>QR codes</h1>
          <span style={{ fontSize: 13.5, color: COLORS.slateMid }}>Guests scan a table&apos;s code on the restaurant&apos;s Wi-Fi to open the menu. A code says which table it is and nothing else.</span>
        </div>
        <span style={{ marginLeft: "auto" }}>
          <Button tone="primary" href="/restaurant/menu-cards?all=1" disabled={!ready || tables.length + points.length === 0} title={ready ? `${printHint} · 4 cards on each A4 sheet` : blocked} data={{ "qr-print-all": "" }}>
            <Printer size={15} strokeWidth={1.8} /> Print all
          </Button>
        </span>
      </div>

      <section data-menu-address style={card}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>Menu address</span>
        {address ? (
          <span style={{ fontSize: 13.5, color: COLORS.text }}>
            Codes open <b data-menu-address-saved style={{ fontFamily: FONTS.mono, fontSize: 13 }}>{address}/menu/…</b>
          </span>
        ) : (
          <div data-menu-address-missing style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 12px", borderRadius: 8, background: AMBER.bg, border: `1px solid ${AMBER.border}`, color: AMBER.fg, fontSize: 13 }}>
            <AlertTriangle size={17} strokeWidth={1.8} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>Choose the address phones on the restaurant&apos;s Wi-Fi reach this server at, then save it. Until then no codes can be printed.</span>
          </div>
        )}
        {choices.length > 0 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: 12.5, color: COLORS.slateMid }}>Found on this server:</span>
            {choices.map((choice) => (
              <button
                key={choice.url}
                type="button"
                data-address-choice={choice.url}
                onClick={() => setTyped(choice.url)}
                style={{ height: 30, padding: "0 12px", borderRadius: 15, border: `1px solid ${typed === choice.url ? COLORS.teal : COLORS.borderStrong}`, background: typed === choice.url ? COLORS.tealTint : "#fff", color: COLORS.text, fontSize: 12.5, cursor: "pointer" }}
              >
                {choice.label}
              </button>
            ))}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input aria-label="Menu address" data-menu-address-input value={typed} placeholder="http://192.168.1.20:3000" onChange={(e) => setTyped(e.target.value)} style={{ ...field, flex: "1 1 320px", fontFamily: FONTS.mono, fontSize: 13 }} />
          <Button tone="primary" disabled={busy !== null || !typed.trim() || typed.trim() === address} onClick={() => act("address", () => saveMenuAddressAction({ address: typed }), "Menu address saved.")} data={{ "menu-address-save": "" }}>
            Save address
          </Button>
        </div>
        <span style={{ fontSize: 12.5, color: COLORS.slateMid }}>
          Printed codes keep this address. Give the server a fixed IP (or a DHCP reservation on the router) so it doesn&apos;t change; if it does, save the new one and print the cards again. The PC&apos;s name (…local) opens on iPhones but not on every Android phone.
        </span>
      </section>

      <section data-menu-wifi style={card}>
        <span style={{ fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
          <Wifi size={16} strokeWidth={1.8} /> Wi-Fi on the cards
        </span>
        <span style={{ fontSize: 12.5, color: COLORS.slateMid }}>Printed on each card so guests can join before they scan. Never shown on the menu itself. Leave the name empty to print no Wi-Fi.</span>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input aria-label="Wi-Fi name" data-wifi-name value={wifi.name} maxLength={WIFI_MAX} placeholder="Network name" onChange={(e) => setWifi({ ...wifi, name: e.target.value })} style={{ ...field, flex: "1 1 220px" }} />
          <input aria-label="Wi-Fi password" data-wifi-password value={wifi.password} maxLength={WIFI_MAX} placeholder="Password (optional)" onChange={(e) => setWifi({ ...wifi, password: e.target.value })} style={{ ...field, flex: "1 1 220px" }} />
          <Button tone="primary" disabled={busy !== null || (wifi.name === wifiName && wifi.password === wifiPassword)} onClick={() => act("wifi", () => saveMenuWifiAction(wifi), "Wi-Fi saved.")} data={{ "wifi-save": "" }}>
            Save Wi-Fi
          </Button>
        </div>
      </section>

      <section data-menu-design-card style={card}>
        <span style={{ fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
          <Palette size={16} strokeWidth={1.8} /> Menu design
        </span>
        <span style={{ fontSize: 12.5, color: COLORS.slateMid }}>How the menu looks on guests&apos; phones. Both show the same dishes, prices and buttons; a phone switches when it next opens or refreshes the menu.</span>
        <div role="radiogroup" aria-label="Menu design" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 10 }}>
          {DESIGNS.map((d) => {
            const on = d.value === design;
            return (
              <button
                key={d.value}
                type="button"
                role="radio"
                aria-checked={on}
                data-menu-design={d.value}
                disabled={busy !== null}
                onClick={() => !on && act("design", () => saveMenuDesignAction({ design: d.value }), `The menu now uses the ${d.name} design.`)}
                style={{ display: "flex", gap: 12, alignItems: "flex-start", textAlign: "left", padding: 12, borderRadius: 10, border: `1.5px solid ${on ? COLORS.teal : COLORS.borderStrong}`, background: on ? COLORS.tealTint : "#fff", cursor: on || busy !== null ? "default" : "pointer", color: COLORS.ink, fontFamily: "inherit" }}
              >
                <DesignSwatch swatch={d.swatch} />
                <span style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600 }}>
                    {d.name}
                    {on && <span style={{ marginLeft: 8, fontSize: 11.5, fontWeight: 600, color: COLORS.teal }}>In use</span>}
                  </span>
                  <span style={{ fontSize: 12.5, color: COLORS.slateMid, lineHeight: 1.45 }}>{d.help}</span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section data-menu-service style={card}>
        <span style={{ fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
          <BellRing size={16} strokeWidth={1.8} /> Guest buttons
        </span>
        <span style={{ fontSize: 12.5, color: COLORS.slateMid }}>
          Buttons along the bottom of a table&apos;s menu. A tap rings a bell on that table on the Tables screen and the waiters&apos; tablets, and pops up for the table&apos;s waiter. Not on QR points.
        </span>
        <Switch
          on={serviceButtons.callWaiter}
          label="Call waiter"
          help="Guests can call a waiter to their table."
          disabled={busy !== null}
          data="callWaiter"
          onChange={(on) => act("service", () => saveServiceButtonsAction({ ...serviceButtons, callWaiter: on }), on ? "Call waiter is on." : "Call waiter is off.")}
        />
        <Switch
          on={serviceButtons.requestBill}
          label="Request bill"
          help="Guests can ask for the bill. Paying stays with staff."
          disabled={busy !== null}
          data="requestBill"
          onChange={(on) => act("service", () => saveServiceButtonsAction({ ...serviceButtons, requestBill: on }), on ? "Request bill is on." : "Request bill is off.")}
        />
      </section>

      <GuestOrderingCard settings={ordering} />

      <section data-qr-tables style={card}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>Tables · {tables.length}</span>
        {tables.length === 0 ? <span style={{ fontSize: 13, color: COLORS.slateMid }}>No tables yet. Add them under Restaurant › Tables.</span> : tables.map(row)}
      </section>

      <section data-qr-points style={card}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>QR points · {points.length}</span>
        <span style={{ fontSize: 12.5, color: COLORS.slateMid }}>Codes that aren&apos;t a table: a takeaway counter (orders by name, paid at the counter) or the bar (opens on the Bar tab).</span>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input aria-label="New point name" data-point-name value={newPoint.name} maxLength={QR_POINT_NAME_MAX} placeholder="e.g. Takeaway counter" onChange={(e) => setNewPoint({ ...newPoint, name: e.target.value })} style={{ ...field, flex: "1 1 240px" }} />
          <select aria-label="New point type" data-point-type value={newPoint.orderType} onChange={(e) => setNewPoint({ ...newPoint, orderType: e.target.value === "BAR_TAB" ? "BAR_TAB" : "TAKEAWAY" })} style={{ ...field, minWidth: 130 }}>
            {QR_POINT_TYPES.map((type) => (
              <option key={type} value={type}>
                {QR_POINT_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
          <Button tone="primary" disabled={busy !== null || !newPoint.name.trim()} onClick={() => act("add", () => addQrPointAction(newPoint), "QR point added.", () => setNewPoint({ name: "", orderType: newPoint.orderType }))} data={{ "point-add": "" }}>
            <Plus size={15} strokeWidth={1.8} /> Add point
          </Button>
        </div>
        {points.map(row)}
      </section>

      {rotating && (
        <ConfirmDeleteModal
          title={`New code for ${rotating.kind === "table" ? `Table ${rotating.title}` : rotating.title}?`}
          message="The printed code stops working straight away: guests scanning it are asked to call a waiter. Print the new card and replace the old one."
          confirmLabel="Rotate code"
          pendingLabel="Rotating…"
          pending={busy === "rotate"}
          onCancel={() => setRotating(null)}
          onConfirm={() => act("rotate", () => rotateMenuQrAction({ kind: rotating.kind, id: rotating.id }), "New code made. Print the new card.", () => setRotating(null))}
        />
      )}
      {removing && (
        <ConfirmDeleteModal
          title={`Remove ${removing.title}?`}
          message="Its printed code stops working straight away."
          confirmLabel="Remove"
          pendingLabel="Removing…"
          pending={busy === "remove"}
          onCancel={() => setRemoving(null)}
          onConfirm={() => act("remove", () => removeQrPointAction(removing.id), "QR point removed.", () => setRemoving(null))}
        />
      )}
    </div>
  );
}
