"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { ChevronLeft, Pencil, Printer as PrinterIcon, Trash2 } from "lucide-react";
import { COLORS, FONTS } from "@/components/layout/theme";
import ConfirmDeleteModal from "@/components/ui/ConfirmDeleteModal";
import IconActionButton from "@/components/ui/IconActionButton";
import { deletePrinter, forgetDevice, printerStatusAction, saveAssignments, saveDevice, testDrawer, testPrint } from "@/app/(dashboard)/settings/printers/actions";
import { DEVICE_ROLES, MAX_COPIES, RECEIPT } from "@/lib/hardware/assignments";
import { CODE_PAGES } from "@/lib/hardware/escpos";
import type { DeviceRow, PrinterRow, PrinterSetup, RoleRow } from "@/lib/hardware/printerSetup";
import PrinterModal from "./PrinterModal";
import PrinterStatusPill from "./PrinterStatusPill";
import MovedPrinterFinder from "./MovedPrinterFinder";

// Settings › Printers: the printers (status polled every 15 s from the
// hardware bridge), the role → printer grid, and devices with their own
// Receipt / Pre-bill printer.

const STATUS_POLL_MS = 15_000;
const CONNECTION_LABEL: Record<PrinterRow["connection"], string> = { OS: "OS", USB: "USB", NETWORK: "Network IP", SERIAL: "Serial" };
const CUT_LABEL: Record<PrinterRow["cut"], string> = { FULL: "Full", PARTIAL: "Partial", NONE: "None" };

const card = { background: "#fff", border: `1px solid ${COLORS.border}`, borderRadius: 12, overflow: "hidden" } as const;
const cardHead = { padding: "16px 20px", borderBottom: `1px solid ${COLORS.border}`, display: "flex", alignItems: "center", gap: 12 } as const;
const th = { padding: "10px 12px", fontSize: 11.5, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: COLORS.slateMid, textAlign: "left", whiteSpace: "nowrap", background: COLORS.bgInput } as const;
const td = { padding: "10px 12px", borderTop: `1px solid ${COLORS.border}`, fontSize: 13.5, verticalAlign: "middle" } as const;
const select = { height: 36, border: `1px solid ${COLORS.borderStrong}`, borderRadius: 8, padding: "0 8px", fontSize: 13.5, background: "#fff", minWidth: 180 } as const;
const primary = { height: 38, padding: "0 16px", border: "none", borderRadius: 8, background: COLORS.teal, color: "#fff", fontSize: 13.5, fontWeight: 600, cursor: "pointer" } as const;
const small = { height: 32, padding: "0 12px", border: `1px solid ${COLORS.borderStrong}`, borderRadius: 7, background: "#fff", fontSize: 12.5, fontWeight: 600, cursor: "pointer" } as const;

function PrinterSelect({ value, printers, placeholder, onChange, label, only }: { value: string | null; printers: PrinterRow[]; placeholder: string; onChange: (id: string | null) => void; label: string; only?: (p: PrinterRow) => boolean }) {
  return (
    <select aria-label={label} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} style={select}>
      <option value="">{placeholder}</option>
      {printers.filter((p) => !only || only(p) || p.id === value).map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
}

function Assignments({ roles, printers }: { roles: RoleRow[]; printers: PrinterRow[] }) {
  // Starts from the server's grid (remounted when that changes — the key below).
  const [rows, setRows] = useState(roles);
  const [saving, setSaving] = useState(false);
  const change = (role: string, patch: Partial<RoleRow>) => setRows((all) => all.map((r) => (r.role === role ? { ...r, ...patch } : r)));
  const dirty = JSON.stringify(rows) !== JSON.stringify(roles);
  const receipt = rows.find((r) => r.role === RECEIPT);
  const receiptPrinter = printers.find((p) => p.id === receipt?.printerId);

  async function save() {
    setSaving(true);
    const result = await saveAssignments({ rows: rows.map((r) => ({ role: r.role, printerId: r.printerId, fallbackPrinterId: r.fallbackPrinterId, copies: r.copies })) });
    setSaving(false);
    if (result.ok) toast.success("Printer assignments saved.");
    else toast.error(result.error);
  }

  return (
    <section aria-label="Assignments" style={card}>
      <div style={cardHead}>
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Which printer does what</h2>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: COLORS.slateMid }}>
            Kitchen tickets go to their station&apos;s printer. While a printer is offline its jobs go to the fallback, marked &ldquo;REROUTED FROM&rdquo; the printer.
          </p>
        </div>
        <button type="button" onClick={() => void save()} disabled={saving || !dirty} style={{ ...primary, background: dirty ? COLORS.teal : COLORS.slateLight, cursor: dirty ? "pointer" : "default" }}>
          {saving ? "Saving…" : "Save assignments"}
        </button>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={th}>Job</th>
            <th style={th}>Printer</th>
            <th style={th}>Copies</th>
            <th style={th}>Fallback</th>
            <th style={th} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const onlyOs = r.kind === "reports" ? (p: PrinterRow) => p.connection === "OS" : undefined;
            const assigned = printers.find((p) => p.id === r.printerId);
            return (
              <tr key={r.role} data-role={r.role}>
                <td style={{ ...td, fontWeight: 600 }}>
                  {r.label}
                  {r.kind === "station" && <span style={{ display: "block", fontSize: 12, fontWeight: 400, color: COLORS.slateMid }}>Kitchen station</span>}
                </td>
                <td style={td}>
                  <PrinterSelect
                    label={`${r.label} printer`}
                    value={r.printerId}
                    printers={printers}
                    only={onlyOs}
                    placeholder={r.kind === "prebill" ? `Same as Receipt${receiptPrinter ? ` (${receiptPrinter.name})` : ""}` : r.kind === "reports" ? "Choose an OS printer…" : "Not assigned"}
                    onChange={(id) => change(r.role, { printerId: id, ...(id ? {} : { fallbackPrinterId: null }) })}
                  />
                </td>
                <td style={td}>
                  {r.kind === "station" ? (
                    <input aria-label={`${r.label} copies`} type="number" min={1} max={MAX_COPIES} value={r.copies} onChange={(e) => change(r.role, { copies: Math.max(1, Math.min(MAX_COPIES, Number(e.target.value) || 1)) })} style={{ ...select, minWidth: 0, width: 70 }} />
                  ) : (
                    <span style={{ color: COLORS.slateLight }}>1</span>
                  )}
                </td>
                <td style={td}>
                  <PrinterSelect label={`${r.label} fallback`} value={r.fallbackPrinterId} printers={printers.filter((p) => p.id !== r.printerId)} only={onlyOs} placeholder="No fallback" onChange={(id) => change(r.role, { fallbackPrinterId: id })} />
                </td>
                <td style={{ ...td, fontSize: 12.5, color: COLORS.slateMid }}>
                  {r.kind === "receipt" && assigned && (assigned.openDrawer ? `Cash drawer on this printer (pin ${assigned.drawerPin})` : "No drawer — tick “A cash drawer is plugged into this printer” on it (Edit)")}
                  {r.kind === "reports" && "Printed through the system print dialog"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function DeviceItem({ device, printers, isThis }: { device: DeviceRow; printers: PrinterRow[]; isThis: boolean }) {
  const [name, setName] = useState(device.name ?? "");
  const [overrides, setOverrides] = useState<Record<string, string | null>>(device.overrides);
  const [saving, setSaving] = useState(false);
  const dirty = name !== (device.name ?? "") || DEVICE_ROLES.some((r) => (overrides[r] ?? null) !== (device.overrides[r] ?? null));

  async function save() {
    setSaving(true);
    const result = await saveDevice({ id: device.id, name, overrides: DEVICE_ROLES.map((role) => ({ role, printerId: overrides[role] ?? null })) });
    setSaving(false);
    if (result.ok) toast.success(`${name || "Device"} saved.`);
    else toast.error(result.error);
  }

  async function forget() {
    const result = await forgetDevice(device.id);
    if (result.ok) toast.success("Device forgotten.");
    else toast.error(result.error);
  }

  return (
    <tr data-device={device.id}>
      <td style={td}>
        <input aria-label="Device name" placeholder="e.g. Cashier tablet 2" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} style={{ ...select, minWidth: 200 }} />
        {isThis && <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 600, color: COLORS.tealDark }}>This device</span>}
      </td>
      <td style={{ ...td, fontSize: 12.5, color: COLORS.slateMid, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={device.userAgent ?? undefined}>
        {new Date(device.lastSeenAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
      </td>
      {DEVICE_ROLES.map((role) => (
        <td key={role} style={td}>
          <PrinterSelect label={`${role === RECEIPT ? "Receipt" : "Pre-bill"} printer for ${name || "this device"}`} value={overrides[role] ?? null} printers={printers} placeholder="Use the role's printer" onChange={(id) => setOverrides((o) => ({ ...o, [role]: id }))} />
        </td>
      ))}
      <td style={{ ...td, whiteSpace: "nowrap" }}>
        <button type="button" onClick={() => void save()} disabled={!dirty || saving} style={{ ...small, color: dirty ? COLORS.tealDark : COLORS.slateLight }}>
          {saving ? "Saving…" : "Save"}
        </button>{" "}
        <button type="button" onClick={() => void forget()} style={{ ...small, color: COLORS.danger }}>
          Forget
        </button>
      </td>
    </tr>
  );
}

export default function PrintersPanel({ setup }: { setup: PrinterSetup }) {
  const { printers, roles, devices, thisDeviceId } = setup;
  const [editing, setEditing] = useState<PrinterRow | "new" | null>(null);
  const [removing, setRemoving] = useState<PrinterRow | null>(null);
  const [status, setStatus] = useState<Record<string, { status: string; detail: string | null }>>({});
  const [bridgeError, setBridgeError] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [kicking, setKicking] = useState<string | null>(null);

  const router = useRouter();
  const poll = useCallback(async () => {
    const result = await printerStatusAction();
    if (result.ok) {
      setStatus(result.statuses);
      setBridgeError(null);
      // Replugged printers found again (Step 7): same printer, new address.
      for (const f of result.found) toast.success(`${f.name} was found again (${f.to}) — same assignments.`);
      if (result.found.length) router.refresh();
    } else setBridgeError(result.error);
  }, [router]);
  useEffect(() => {
    const first = setTimeout(() => void poll(), 0);
    const timer = setInterval(() => void poll(), STATUS_POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [poll, printers.length]);

  async function test(p: PrinterRow) {
    setTesting(p.id);
    const result = await testPrint(p.id);
    setTesting(null);
    if (result.ok) toast.success(`Test page sent to ${p.name}.`);
    else toast.error(result.error);
    void poll();
  }

  async function kick(p: PrinterRow) {
    setKicking(p.id);
    const result = await testDrawer(p.id);
    setKicking(null);
    if (result.ok) toast.success(`Drawer kick sent to ${p.name} — the drawer should be open.`);
    else toast.error(result.error);
  }

  async function remove() {
    if (!removing) return;
    const result = await deletePrinter(removing.id);
    setRemoving(null);
    if (result.ok) toast.success(`${removing.name} removed.`);
    else toast.error(result.error);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Link href="/settings" aria-label="Back to Settings" style={{ width: 34, height: 34, borderRadius: 8, border: `1px solid ${COLORS.border}`, display: "flex", alignItems: "center", justifyContent: "center", color: COLORS.slate }}>
          <ChevronLeft size={16} strokeWidth={1.8} />
        </Link>
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: 0, fontFamily: FONTS.display, fontSize: 26, fontWeight: 700, letterSpacing: "-.015em" }}>Printers</h1>
          <p style={{ margin: "2px 0 0", fontSize: 13.5, color: COLORS.slateMid }}>Thermal and A4 printers on the server or the network. Every device prints through the server.</p>
        </div>
        <Link href="/settings/ticket-templates" style={{ ...small, height: 38, display: "inline-flex", alignItems: "center", color: COLORS.slate, textDecoration: "none" }}>
          Ticket templates
        </Link>
        <Link href="/settings/print-queue" style={{ ...small, height: 38, display: "inline-flex", alignItems: "center", color: COLORS.slate, textDecoration: "none" }}>
          Print queue
        </Link>
        <Link href="/settings/drawer-log" style={{ ...small, height: 38, display: "inline-flex", alignItems: "center", color: COLORS.slate, textDecoration: "none" }}>
          Drawer log
        </Link>
        <button type="button" onClick={() => setEditing("new")} style={primary}>
          + Add printer
        </button>
      </div>

      {bridgeError && (
        <p role="alert" data-bridge-error style={{ margin: 0, padding: "10px 14px", borderRadius: 9, background: "#fcecef", color: COLORS.danger, fontSize: 13.5 }}>
          {bridgeError}
        </p>
      )}

      <section aria-label="Printer list" style={card}>
        {printers.length === 0 ? (
          <div style={{ padding: "36px 20px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, color: COLORS.slateMid, fontSize: 13.5 }}>
            <PrinterIcon size={22} strokeWidth={1.6} />
            No printers yet. Add one: the server finds the ones it can reach, or type a network printer&apos;s IP.
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Name", "Connection", "Paper", "Code page", "Cut", "Drawer", "Status", ""].map((h) => (
                  <th key={h} style={th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {printers.map((p) => {
                const live = status[p.id];
                return (
                  <tr key={p.id} data-printer={p.name}>
                    <td style={td}>
                      <span style={{ fontWeight: 600 }}>{p.name}</span>
                      {p.model && <span style={{ display: "block", fontSize: 12, color: COLORS.slateMid }}>{p.model}</span>}
                    </td>
                    <td style={td}>
                      {CONNECTION_LABEL[p.connection]}
                      <span style={{ display: "block", fontSize: 12, color: COLORS.slateMid, fontFamily: FONTS.mono }}>{p.address}</span>
                    </td>
                    <td style={td}>{p.paperWidth} mm</td>
                    <td style={{ ...td, fontFamily: FONTS.mono, fontSize: 12.5 }} title={CODE_PAGES[p.codePage]?.label}>
                      {p.codePage}
                    </td>
                    <td style={td}>{CUT_LABEL[p.cut]}</td>
                    <td style={td}>{p.openDrawer ? `Pin ${p.drawerPin}` : "None"}</td>
                    <td style={td}>
                      <PrinterStatusPill status={live?.status ?? (bridgeError ? (p.lastStatus ?? "UNKNOWN") : "CHECKING")} detail={live?.detail} />
                      {p.connection === "NETWORK" && live?.status === "OFFLINE" && <MovedPrinterFinder printerId={p.id} name={p.name} />}
                    </td>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>
                      <span style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6 }}>
                      <button type="button" aria-label={`Test print on ${p.name}`} onClick={() => void test(p)} disabled={testing === p.id} style={{ ...small, color: COLORS.tealDark }}>
                        {testing === p.id ? "Printing…" : "Test print"}
                      </button>
                      {p.openDrawer && (
                        <button type="button" aria-label={`Test drawer on ${p.name}`} onClick={() => void kick(p)} disabled={kicking === p.id} style={{ ...small, color: COLORS.tealDark }}>
                          {kicking === p.id ? "Opening…" : "Test drawer"}
                        </button>
                      )}
                      <IconActionButton icon={<Pencil size={13} strokeWidth={1.8} />} title={`Edit ${p.name}`} size={32} onClick={() => setEditing(p)} />
                      <IconActionButton icon={<Trash2 size={13} strokeWidth={1.8} />} title={`Remove ${p.name}`} size={32} onClick={() => setRemoving(p)} />
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <Assignments key={JSON.stringify(roles)} roles={roles} printers={printers} />

      <section aria-label="Devices" style={card}>
        <div style={cardHead}>
          <div>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Devices</h2>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: COLORS.slateMid }}>
              Tablets and PCs that have opened POS, the kitchen display or an order screen. Give one its own Receipt or Pre-bill printer here (e.g. Cashier tablet 2 → Receipt printer 2).
            </p>
          </div>
          <Link href="/settings/scanner" style={{ ...small, marginLeft: "auto", display: "inline-flex", alignItems: "center", color: COLORS.slate, textDecoration: "none", whiteSpace: "nowrap" }}>
            Scanner test
          </Link>
        </div>
        {devices.length === 0 ? (
          <p style={{ margin: 0, padding: "20px", fontSize: 13.5, color: COLORS.slateMid }}>No devices yet.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>Device</th>
                <th style={th}>Last seen</th>
                <th style={th}>Receipt printer</th>
                <th style={th}>Pre-bill printer</th>
                <th style={th} />
              </tr>
            </thead>
            <tbody>
              {devices.map((d) => (
                <DeviceItem key={d.id} device={d} printers={printers} isThis={d.id === thisDeviceId} />
              ))}
            </tbody>
          </table>
        )}
      </section>

      {editing && <PrinterModal printer={editing === "new" ? null : editing} existing={printers} onClose={() => setEditing(null)} />}
      {removing && (
        <ConfirmDeleteModal
          title="Remove printer"
          message={`Remove "${removing.name}"? Devices that print on it go back to their role's printer.`}
          onCancel={() => setRemoving(null)}
          onConfirm={() => void remove()}
          pending={false}
          confirmLabel="Remove"
          pendingLabel="Removing…"
        />
      )}
    </div>
  );
}

