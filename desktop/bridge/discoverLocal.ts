import { readdir } from "node:fs/promises";
import { lpstatPrinters, serialPort, windowsPrinters, windowsSerialPorts, windowsUsbDevices } from "./parse.ts";
import { powershell, run } from "./run.ts";
import type { DiscoveredPrinter } from "./types.ts";

// This machine's printers: its OS print queues, raw USB printing devices and
// serial ports. Windows: one PowerShell call. Linux / macOS: CUPS (lpstat)
// and the device files.

const WINDOWS_SCRIPT = `
$p = @(Get-CimInstance Win32_Printer | Select-Object Name, PortName, DriverName, WorkOffline, PrinterStatus, DetectedErrorState)
$u = @(Get-CimInstance Win32_PnPEntity -Filter "Service='usbprint'" | Select-Object Name, DeviceID, Status, Manufacturer)
$s = @(Get-CimInstance Win32_SerialPort | Select-Object DeviceID, Name, Status)
$n = @([System.IO.Ports.SerialPort]::GetPortNames())
[pscustomobject]@{ printers = $p; usb = $u; serial = $s; ports = $n } | ConvertTo-Json -Depth 4 -Compress
`;

export async function discoverLocal(): Promise<{ printers: DiscoveredPrinter[]; errors: string[] }> {
  return process.platform === "win32" ? discoverWindows() : discoverUnix();
}

async function discoverWindows(): Promise<{ printers: DiscoveredPrinter[]; errors: string[] }> {
  try {
    const out = (await powershell(WINDOWS_SCRIPT)).trim();
    const data = (out ? JSON.parse(out) : {}) as { printers?: unknown; usb?: unknown; serial?: unknown; ports?: unknown };
    return {
      printers: [...windowsPrinters(data.printers), ...windowsUsbDevices(data.usb), ...windowsSerialPorts(data.serial, data.ports)],
      errors: [],
    };
  } catch (error) {
    return { printers: [], errors: [`Local printers: ${(error as Error).message}`] };
  }
}

async function devices(dir: string, pattern: RegExp): Promise<string[]> {
  try {
    return (await readdir(dir)).filter((name) => pattern.test(name)).map((name) => `${dir}/${name}`);
  } catch {
    return [];
  }
}

async function discoverUnix(): Promise<{ printers: DiscoveredPrinter[]; errors: string[] }> {
  const errors: string[] = [];
  let queues: DiscoveredPrinter[] = [];
  try {
    const [v, p] = await Promise.all([run("lpstat", ["-v"]), run("lpstat", ["-p"]).catch(() => "")]);
    queues = lpstatPrinters(v, p);
  } catch (error) {
    errors.push(`Print queues (CUPS): ${(error as Error).message}`);
  }
  // Raw USB printers (Linux usblp) and serial ports.
  const usb = (await devices("/dev/usb", /^lp\d+$/)).map(
    (path): DiscoveredPrinter => ({ id: `usb:${path}`, name: `USB printer ${path}`, connection: "USB", address: path, model: null, status: "ONLINE", statusDetail: "Connected", identity: {} }),
  );
  const serial = (await devices("/dev", /^(ttyS[0-3]|ttyUSB\d+|ttyACM\d+|tty\.usbserial.*|cu\.usbserial.*)$/)).map((path) => serialPort(path, `Serial port ${path}`));
  return { printers: [...queues, ...usb, ...serial], errors };
}
