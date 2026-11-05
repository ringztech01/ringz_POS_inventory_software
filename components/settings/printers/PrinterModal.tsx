"use client";

import { useState, type FormEvent } from "react";
import toast from "react-hot-toast";
import { Radar, Search } from "lucide-react";
import MasterDataModal from "@/components/ui/MasterDataModal";
import { Field, SelectInput } from "@/components/purchases/form-fields";
import { COLORS, FONTS } from "@/components/layout/theme";
import { discoverAction, probeAction, savePrinter, testPrint } from "@/app/(dashboard)/settings/printers/actions";
import { CODE_PAGES, type CodePage } from "@/lib/hardware/escpos";
import type { PrinterRow } from "@/lib/hardware/printerSetup";
import { BAUD_RATES, PRINTER_NAME_MAX, type PrinterField } from "@/lib/validations/printer";
import type { DiscoveredPrinter } from "@/desktop/bridge/types.ts";
import PrinterStatusPill from "./PrinterStatusPill";

// Add or edit a printer (the shared modal shell). Adding: pick one the
// hardware bridge found on the server (its printers, USB devices, serial
// ports, and a LAN scan for port 9100) or check an IP by hand, then set its
// paper, code page, cut and drawer. A new printer gets a test print at once.

type Connection = PrinterRow["connection"];
type Form = Omit<PrinterRow, "id" | "lastStatus"> & { identity: DiscoveredPrinter["identity"] | null };

const CONNECTION_OPTIONS = [
  { value: "OS", label: "OS printer (print queue)" },
  { value: "NETWORK", label: "Network IP (port 9100)" },
  { value: "USB", label: "USB device" },
  { value: "SERIAL", label: "Serial / COM port" },
];
const CODE_PAGE_OPTIONS = Object.entries(CODE_PAGES).map(([value, page]) => ({ value, label: page.label }));
const CUT_OPTIONS = [
  { value: "PARTIAL", label: "Partial cut" },
  { value: "FULL", label: "Full cut" },
  { value: "NONE", label: "No cut (tear off)" },
];

const EMPTY: Form = { name: "", connection: "NETWORK", address: "", paperWidth: 80, codePage: "PC437", cut: "PARTIAL", openDrawer: false, drawerPin: 2, baudRate: 9600, model: null, identity: null };

// What a discovered printer prints to: an OS printer by its queue name.
function fromDiscovered(found: DiscoveredPrinter): Form {
  return {
    ...EMPTY,
    name: found.name.slice(0, PRINTER_NAME_MAX),
    connection: found.connection,
    address: found.connection === "OS" ? found.name : found.address,
    paperWidth: /58/.test(`${found.name} ${found.model ?? ""}`) ? 58 : 80,
    model: found.model,
    identity: found.identity,
  };
}

const sameTarget = (a: { connection: Connection; address: string }, b: { connection: Connection; address: string }) => a.connection === b.connection && a.address.toLowerCase() === b.address.toLowerCase();

const field = { height: 40, border: `1px solid ${COLORS.borderStrong}`, borderRadius: 8, padding: "0 12px", fontSize: 14, outline: "none", width: "100%" } as const;
const ghost = { height: 38, padding: "0 14px", border: `1px solid ${COLORS.borderStrong}`, borderRadius: 8, background: "#fff", fontSize: 13.5, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 } as const;

export default function PrinterModal({ printer, existing, onClose }: { printer: PrinterRow | null; existing: PrinterRow[]; onClose: () => void }) {
  const adding = !printer;
  const [form, setForm] = useState<Form>(printer ? { ...printer, identity: null } : EMPTY);
  const [picked, setPicked] = useState(!adding);
  const [found, setFound] = useState<DiscoveredPrinter[] | null>(null);
  const [scanNetwork, setScanNetwork] = useState(true);
  const [finding, setFinding] = useState(false);
  const [findError, setFindError] = useState<string | null>(null);
  const [ip, setIp] = useState("");
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState<DiscoveredPrinter | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<PrinterField, string[]>>>({});
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));
  const use = (p: DiscoveredPrinter) => {
    setForm(fromDiscovered(p));
    setPicked(true);
  };

  async function find() {
    setFinding(true);
    setFindError(null);
    const result = await discoverAction(scanNetwork);
    setFinding(false);
    if (result.ok) {
      setFound(result.printers);
      if (result.errors.length) setFindError(result.errors.join(" · "));
    } else setFindError(result.error);
  }

  async function check() {
    if (!ip.trim()) return;
    setChecking(true);
    setChecked(null);
    const result = await probeAction(ip);
    setChecking(false);
    if (result.ok) setChecked(result.printer);
    else toast.error(result.error);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !picked) return;
    setSaving(true);
    setFieldErrors({});
    const result = await savePrinter(printer?.id ?? null, form);
    if (!result.ok) {
      setSaving(false);
      setFieldErrors(result.fieldErrors ?? {});
      toast.error(result.error);
      return;
    }
    if (adding) {
      // A new printer: test it straight away.
      const test = await testPrint(result.id);
      if (test.ok) toast.success(`${form.name} added — test page sent.`);
      else toast.error(`${form.name} added, but the test print failed: ${test.error.replace(/^Test print failed: /, "")}`);
    } else toast.success(`${form.name} saved.`);
    setSaving(false);
    onClose();
  }

  const row = (p: DiscoveredPrinter) => {
    const added = existing.some((e) => sameTarget(e, { connection: p.connection, address: p.connection === "OS" ? p.name : p.address }));
    return (
      <div key={p.id} data-found={p.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderTop: `1px solid ${COLORS.border}` }}>
        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: 13.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
          <span style={{ fontSize: 12, color: COLORS.slateMid, fontFamily: FONTS.mono, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {p.connection} · {p.address}
            {p.model ? ` · ${p.model}` : ""}
          </span>
        </span>
        <PrinterStatusPill status={p.status} detail={p.statusDetail} />
        {added ? (
          <span style={{ fontSize: 12.5, color: COLORS.slateMid, width: 52, textAlign: "right" }}>Added</span>
        ) : (
          <button type="button" aria-label={`Use ${p.name}`} onClick={() => use(p)} style={{ ...ghost, height: 32, padding: "0 12px", color: COLORS.tealDark }}>
            Use
          </button>
        )}
      </div>
    );
  };

  return (
    <MasterDataModal
      title={adding ? "Add printer" : `Edit ${printer.name}`}
      onClose={onClose}
      onSubmit={handleSubmit}
      submitting={saving}
      submitDisabled={!picked}
      submitLabel={adding ? "Add & test print" : "Save"}
      width={620}
    >
      {adding && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button type="button" onClick={() => void find()} disabled={finding} style={{ ...ghost, color: COLORS.tealDark }}>
              <Radar size={15} strokeWidth={1.8} /> {finding ? "Looking…" : found ? "Look again" : "Find printers"}
            </button>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: COLORS.slate }}>
              <input type="checkbox" checked={scanNetwork} onChange={(e) => setScanNetwork(e.target.checked)} /> Scan the network too (a few seconds)
            </label>
          </div>
          {findError && <p role="alert" style={{ margin: 0, fontSize: 12.5, color: COLORS.danger }}>{findError}</p>}
          {found && (
            <div aria-label="Found printers" style={{ maxHeight: 240, overflowY: "auto" }}>
              {found.length === 0 ? <p style={{ margin: 0, fontSize: 13, color: COLORS.slateMid }}>Nothing found. Check it&apos;s on and connected, or add it by IP below.</p> : found.map(row)}
            </div>
          )}
          <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
            <Field label="Or add a network printer by IP">
              <input aria-label="Printer IP" placeholder="192.168.1.50 or 192.168.1.50:9100" value={ip} onChange={(e) => setIp(e.target.value)} style={{ ...field, width: 300 }} />
            </Field>
            <button type="button" onClick={() => void check()} disabled={checking || !ip.trim()} style={ghost}>
              <Search size={14} strokeWidth={1.8} /> {checking ? "Checking…" : "Check"}
            </button>
          </div>
          {checked && <div aria-label="Checked printer">{row(checked)}</div>}
        </div>
      )}

      {picked && (
        <div aria-label="Printer settings" style={{ display: "flex", flexDirection: "column", gap: 14, paddingTop: adding ? 6 : 0, borderTop: adding ? `1px solid ${COLORS.border}` : "none" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Name" required error={fieldErrors.name?.[0]}>
              <input aria-label="Name" value={form.name} maxLength={PRINTER_NAME_MAX} onChange={(e) => set("name", e.target.value)} style={field} />
            </Field>
            <Field label="Connection" error={fieldErrors.connection?.[0]}>
              <div data-field="connection">
                <SelectInput value={form.connection} onChange={(v) => set("connection", v as Connection)} options={CONNECTION_OPTIONS} />
              </div>
            </Field>
          </div>
          <Field label={form.connection === "OS" ? "Print queue name" : form.connection === "NETWORK" ? "IP address[:port]" : form.connection === "SERIAL" ? "Port" : "Device"} required error={fieldErrors.address?.[0]}>
            <input aria-label="Address" value={form.address} onChange={(e) => set("address", e.target.value)} style={{ ...field, fontFamily: FONTS.mono }} />
          </Field>
          {form.connection === "USB" && (
            <p style={{ margin: 0, fontSize: 12.5, color: COLORS.slateMid }}>
              On a Windows server, a raw USB printer prints once it has a print queue: add it in Windows as a &ldquo;Generic / Text Only&rdquo; printer on its USB port, then pick that OS printer here.
            </p>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <Field label="Paper width">
              <div data-field="paperWidth">
                <SelectInput value={String(form.paperWidth)} onChange={(v) => set("paperWidth", Number(v))} options={[{ value: "80", label: "80 mm" }, { value: "58", label: "58 mm" }]} />
              </div>
            </Field>
            <Field label="Code page" error={fieldErrors.codePage?.[0]}>
              <div data-field="codePage">
                <SelectInput value={form.codePage} onChange={(v) => set("codePage", v as CodePage)} options={CODE_PAGE_OPTIONS} />
              </div>
            </Field>
            <Field label="Cut">
              <div data-field="cut">
                <SelectInput value={form.cut} onChange={(v) => set("cut", v as Form["cut"])} options={CUT_OPTIONS} />
              </div>
            </Field>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, fontWeight: 600 }}>
              <input type="checkbox" aria-label="Cash drawer" checked={form.openDrawer} onChange={(e) => set("openDrawer", e.target.checked)} /> A cash drawer is plugged into this printer
            </label>
            {form.openDrawer && (
              <div data-field="drawerPin" style={{ width: 150 }}>
                <SelectInput value={String(form.drawerPin)} onChange={(v) => set("drawerPin", Number(v))} options={[{ value: "2", label: "Drawer pin 2" }, { value: "5", label: "Drawer pin 5" }]} />
              </div>
            )}
            {form.connection === "SERIAL" && (
              <div data-field="baudRate" style={{ width: 150 }}>
                <SelectInput value={String(form.baudRate)} onChange={(v) => set("baudRate", Number(v))} options={BAUD_RATES.map((r) => ({ value: String(r), label: `${r} baud` }))} />
              </div>
            )}
          </div>
        </div>
      )}
    </MasterDataModal>
  );
}
