import type { DiscoveredPrinter, PrinterStatus } from "./types.ts";

// Turning the operating system's answers into DiscoveredPrinters — pure, so
// the rules are tested without the hardware (__tests__/bridge.test.ts).
//   Windows  one PowerShell call (discoverOs.ts) returns Win32_Printer,
//            the "USB Printing Support" devices (Win32_PnPEntity, service
//            usbprint) and the serial ports, as JSON
//   Linux /  CUPS: `lpstat -v` (each queue's device URI) and `lpstat -p`
//   macOS    (enabled / disabled)

// ConvertTo-Json gives an object for one row, an array for several, nothing for none.
export function rowsOf(json: unknown): Record<string, unknown>[] {
  if (json === null || json === undefined) return [];
  const list = Array.isArray(json) ? json : [json];
  return list.filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null);
}

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "");
const num = (value: unknown): number | null => (typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : null);

// Win32_Printer's state: DetectedErrorState 4 = no paper, 9 = offline;
// PrinterStatus 7 = offline; WorkOffline = "Use printer offline" (or the
// spooler found it unplugged). Anything else is taken as online.
export function windowsPrinterStatus(row: Record<string, unknown>): { status: PrinterStatus; detail: string | null } {
  const error = num(row.DetectedErrorState);
  const state = num(row.PrinterStatus);
  if (error === 4) return { status: "PAPER_OUT", detail: "Paper out" };
  if (row.WorkOffline === true) return { status: "OFFLINE", detail: "Work offline" };
  if (error === 9 || state === 7) return { status: "OFFLINE", detail: "Offline" };
  if (error === 3) return { status: "ONLINE", detail: "Paper low" };
  if (error === 7) return { status: "OFFLINE", detail: "Door open" };
  if (error === 8) return { status: "OFFLINE", detail: "Paper jam" };
  return { status: "ONLINE", detail: state === 4 ? "Printing" : null };
}

export function windowsPrinters(json: unknown): DiscoveredPrinter[] {
  return rowsOf(json)
    .filter((row) => text(row.Name))
    .map((row) => {
      const name = text(row.Name);
      const { status, detail } = windowsPrinterStatus(row);
      return {
        id: `os:${name}`,
        name,
        connection: "OS",
        address: text(row.PortName),
        model: text(row.DriverName) || null,
        status,
        statusDetail: detail,
        identity: { osName: name },
      };
    });
}

// "USB\VID_0416&PID_5011\A1B2C3" → its ids and serial. The last part is a
// serial only when the device reports one; Windows' own instance ids
// ("5&2B6C0F&0&2") have "&" in them.
export function usbIds(deviceId: string): { vendorId?: string; productId?: string; serial?: string } {
  const match = /VID_([0-9A-F]{4})&PID_([0-9A-F]{4})(?:[^\\]*)\\?(.*)$/i.exec(deviceId);
  if (!match) return {};
  const serial = match[3] && !match[3].includes("&") ? match[3] : undefined;
  return { vendorId: match[1].toUpperCase(), productId: match[2].toUpperCase(), ...(serial ? { serial } : {}) };
}

export function windowsUsbDevices(json: unknown): DiscoveredPrinter[] {
  return rowsOf(json)
    .filter((row) => text(row.DeviceID))
    .map((row) => {
      const deviceId = text(row.DeviceID);
      const ids = usbIds(deviceId);
      const present = text(row.Status).toUpperCase() === "OK";
      const label = ids.vendorId ? `USB printer ${ids.vendorId}:${ids.productId}` : "USB printer";
      return {
        id: `usb:${deviceId}`,
        name: text(row.Name) && text(row.Name) !== "USB Printing Support" ? text(row.Name) : label,
        connection: "USB",
        address: deviceId,
        model: text(row.Manufacturer) && text(row.Manufacturer) !== "(Standard USB Host Controller)" ? text(row.Manufacturer) : null,
        status: present ? "ONLINE" : "OFFLINE",
        statusDetail: present ? "Connected" : text(row.Status) || "Not connected",
        identity: ids,
      };
    });
}

// Serial ports: Win32_SerialPort's (with a name), plus any port only .NET
// lists (USB-serial adapters). Whether a printer or drawer is on one can't
// be told without opening it.
export function windowsSerialPorts(json: unknown, portNames: unknown): DiscoveredPrinter[] {
  const named = rowsOf(json).filter((row) => text(row.DeviceID));
  const names = new Map(named.map((row) => [text(row.DeviceID).toUpperCase(), text(row.Name)]));
  const extra: unknown[] = Array.isArray(portNames) ? portNames : typeof portNames === "string" ? [portNames] : [];
  for (const port of extra) {
    const id = text(port).toUpperCase();
    if (id && !names.has(id)) names.set(id, "");
  }
  return [...names.entries()]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([port, name]) => serialPort(port, name || `Serial port ${port}`));
}

export function serialPort(path: string, name: string): DiscoveredPrinter {
  return { id: `serial:${path}`, name, connection: "SERIAL", address: path, model: null, status: "UNKNOWN", statusDetail: "Can't tell without opening the port", identity: {} };
}

// CUPS: "device for TM20: usb://EPSON/TM-T20II?serial=X4FJ012345" and
// "printer TM20 is idle.  enabled since …" / "printer TM20 disabled since …".
export function lpstatPrinters(devices: string, states: string): DiscoveredPrinter[] {
  const state = new Map<string, string>();
  for (const line of states.split(/\r?\n/)) {
    const match = /^printer (\S+) (.*)$/.exec(line.trim());
    if (match) state.set(match[1], match[2]);
  }
  const out: DiscoveredPrinter[] = [];
  for (const line of devices.split(/\r?\n/)) {
    const match = /^device for (\S+): (\S+)/.exec(line.trim());
    if (!match) continue;
    const [, name, uri] = match;
    const how = state.get(name) ?? "";
    const disabled = /disabled/i.test(how);
    const usb = /^usb:\/\/([^/]+)\/([^?]+)(?:\?serial=([^&]+))?/i.exec(uri);
    out.push({
      id: `os:${name}`,
      name,
      connection: "OS",
      address: uri,
      model: usb ? decodeURIComponent(`${usb[1]} ${usb[2]}`) : null,
      status: disabled ? "OFFLINE" : how ? "ONLINE" : "UNKNOWN",
      statusDetail: disabled ? "Disabled in CUPS" : null,
      identity: { osName: name, ...(usb?.[3] ? { serial: decodeURIComponent(usb[3]) } : {}) },
    });
  }
  return out;
}
