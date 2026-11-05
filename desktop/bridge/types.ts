// The hardware bridge's shared shapes (desktop/bridge/README.md). Plain
// types only: Node runs these files directly (type stripping), so nothing
// here may need compiling — no enums, no namespaces.

// How the app reaches a printer:
//   OS       an OS print queue (Windows spooler / CUPS) — on USB, LAN or a
//            virtual port; raw ESC/POS goes through it as RAW data
//   USB      a raw USB printing device the OS knows (Windows "USB Printing
//            Support"); printable once it has an OS queue on its USB port
//   NETWORK  a LAN printer taking raw jobs on TCP (port 9100)
//   SERIAL   a COM / tty port (older printers, cash drawers)
export type PrinterConnection = "OS" | "USB" | "NETWORK" | "SERIAL";

// What the printer (or the OS for it) reports. UNKNOWN: it can't tell
// without sending something (a serial port, a LAN device not yet queried).
export type PrinterStatus = "ONLINE" | "OFFLINE" | "PAPER_OUT" | "UNKNOWN";

// What identifies the same physical printer again later (Step 7's
// re-detection): its USB ids and serial, its OS queue name, its MAC.
export type PrinterIdentity = {
  vendorId?: string;
  productId?: string;
  serial?: string;
  osName?: string;
  mac?: string;
};

export type DiscoveredPrinter = {
  // Stable within one machine: "os:<queue>", "usb:<device id>",
  // "net:<ip>:<port>", "serial:<port>".
  id: string;
  name: string;
  connection: PrinterConnection;
  // The OS port (USB001, IP_192.168.1.50, COM3), "ip:port", or the device path.
  address: string;
  // As reported (driver name, SNMP sysDescr, ESC/POS model id); null if none.
  model: string | null;
  status: PrinterStatus;
  // Why, in words ("Paper out", "Work offline", "No status reply").
  statusDetail: string | null;
  identity: PrinterIdentity;
};

export type DiscoveryResult = {
  printers: DiscoveredPrinter[];
  // One source failing (no PowerShell, no network) doesn't stop the others.
  errors: string[];
  // The LAN ranges scanned ("192.168.1.0/24").
  subnets: string[];
  tookMs: number;
};
