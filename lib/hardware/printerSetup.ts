import "server-only";
import type { PrinterConnection, PrinterCut } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isModuleEnabled } from "@/lib/modules/enabled.server";
import { PREBILL, RECEIPT, REPORTS, stationRole } from "./assignments";
import { currentDeviceId } from "./device";
import type { CodePage } from "./escpos";

// Settings › Printers' data: the printers, the role grid (each kitchen
// station while the Restaurant module is on, Receipt, Pre-bill, Reports) and
// the devices with their overrides.

export type PrinterRow = {
  id: string;
  name: string;
  connection: PrinterConnection;
  address: string;
  paperWidth: number;
  codePage: CodePage;
  cut: PrinterCut;
  openDrawer: boolean;
  drawerPin: number;
  baudRate: number;
  model: string | null;
  lastStatus: string | null;
};

export type RoleKind = "station" | "receipt" | "prebill" | "reports";
export type RoleRow = { role: string; label: string; kind: RoleKind; printerId: string | null; fallbackPrinterId: string | null; copies: number };
export type DeviceRow = { id: string; name: string | null; userAgent: string | null; lastSeenAt: string; overrides: Record<string, string> };

export type PrinterSetup = { printers: PrinterRow[]; roles: RoleRow[]; devices: DeviceRow[]; thisDeviceId: string | null };

// The roles to show, in order: stations (module on), Receipt, Pre-bill, Reports.
export async function printerRoles(): Promise<{ role: string; label: string; kind: RoleKind }[]> {
  const stations = (await isModuleEnabled("restaurant"))
    ? await prisma.kitchenStation.findMany({ where: { deletedAt: null, isActive: true }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: { id: true, name: true } })
    : [];
  return [
    ...stations.map((s) => ({ role: stationRole(s.id), label: s.name, kind: "station" as const })),
    { role: RECEIPT, label: "Receipt (cashier stand)", kind: "receipt" },
    { role: PREBILL, label: "Pre-bill", kind: "prebill" },
    { role: REPORTS, label: "Reports (A4)", kind: "reports" },
  ];
}

export async function getPrinterSetup(): Promise<PrinterSetup> {
  const [printers, assignments, devices, roles, thisDeviceId] = await Promise.all([
    prisma.printer.findMany({ where: { deletedAt: null }, orderBy: [{ name: "asc" }, { createdAt: "asc" }] }),
    prisma.printerAssignment.findMany({ select: { role: true, printerId: true, fallbackPrinterId: true, copies: true } }),
    prisma.device.findMany({ orderBy: [{ lastSeenAt: "desc" }], take: 100, include: { overrides: { select: { role: true, printerId: true } } } }),
    printerRoles(),
    currentDeviceId(),
  ]);
  const byRole = new Map(assignments.map((a) => [a.role, a]));
  return {
    printers: printers.map((p) => ({
      id: p.id,
      name: p.name,
      connection: p.connection,
      address: p.address,
      paperWidth: p.paperWidth,
      codePage: p.codePage as CodePage,
      cut: p.cut,
      openDrawer: p.openDrawer,
      drawerPin: p.drawerPin,
      baudRate: p.baudRate,
      model: p.model,
      lastStatus: p.lastStatus,
    })),
    roles: roles.map((r) => {
      const a = byRole.get(r.role);
      return { ...r, printerId: a?.printerId ?? null, fallbackPrinterId: a?.fallbackPrinterId ?? null, copies: a?.copies ?? 1 };
    }),
    devices: devices.map((d) => ({
      id: d.id,
      name: d.name,
      userAgent: d.userAgent,
      lastSeenAt: d.lastSeenAt.toISOString(),
      overrides: Object.fromEntries(d.overrides.map((o) => [o.role, o.printerId])),
    })),
    thisDeviceId,
  };
}
