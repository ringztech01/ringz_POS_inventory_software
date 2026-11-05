import { writeFile, unlink } from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { parseTarget } from "./discoverNetwork.ts";
import { powershell, run } from "./run.ts";
import type { PrinterConnection } from "./types.ts";

// Sending raw bytes (ESC/POS, built by the app server) to a printer — no
// drivers involved, no packages:
//   NETWORK  TCP to host:port (9100), all bytes, then close
//   OS       Windows: the spooler as a RAW document (winspool via a few
//            lines of C# in PowerShell); Linux / macOS: `lp -o raw`
//   SERIAL   Windows: .NET SerialPort at the printer's baud rate; Linux /
//            macOS: written to the tty
//   USB      Linux: written to its device file (/dev/usb/lp0). Windows has
//            no raw path without a driver: give it an OS queue on its USB
//            port (Generic / Text Only) and print to that.
// Values reach the scripts as environment variables, never in their text.

export type PrintTarget = { connection: PrinterConnection; address: string; baudRate?: number };

const MAX_BYTES = 2 * 1024 * 1024;

function sendTcp(host: string, port: number, data: Uint8Array, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port });
    let settled = false;
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(new Error(message));
    };
    socket.setTimeout(timeoutMs, () => fail(`No answer from ${host}:${port}.`));
    socket.once("error", (error: NodeJS.ErrnoException) => fail(error.code === "ECONNREFUSED" ? `${host}:${port} refused the connection — is it on?` : `Can't reach ${host}:${port} (${error.code ?? error.message}).`));
    socket.once("connect", () => {
      socket.end(Buffer.from(data), () => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve();
      });
    });
  });
}

const WINDOWS_RAW = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class RingzRawPrint {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFO { public string pDocName; public string pOutputFile; public string pDatatype; }
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool OpenPrinter(string name, out IntPtr h, IntPtr d);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)] static extern int StartDocPrinter(IntPtr h, int level, [In] DOCINFO di);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool WritePrinter(IntPtr h, byte[] buf, int count, out int written);
  public static void Send(string printer, byte[] bytes, string doc) {
    IntPtr h;
    if (!OpenPrinter(printer, out h, IntPtr.Zero)) throw new Exception("No printer named '" + printer + "' (error " + Marshal.GetLastWin32Error() + ").");
    try {
      var di = new DOCINFO { pDocName = doc, pDatatype = "RAW" };
      if (StartDocPrinter(h, 1, di) == 0) throw new Exception("The spooler refused the job (error " + Marshal.GetLastWin32Error() + ").");
      try {
        StartPagePrinter(h);
        int written;
        if (!WritePrinter(h, bytes, bytes.Length, out written) || written != bytes.Length) throw new Exception("Only " + written + " of " + bytes.Length + " bytes were sent.");
        EndPagePrinter(h);
      } finally { EndDocPrinter(h); }
    } finally { ClosePrinter(h); }
  }
}
"@
[RingzRawPrint]::Send($env:RINGZ_PRINTER, [IO.File]::ReadAllBytes($env:RINGZ_FILE), 'RingzPOS')
'sent'
`;

const WINDOWS_SERIAL = `
$ErrorActionPreference = 'Stop'
$port = New-Object System.IO.Ports.SerialPort $env:RINGZ_PORT, ([int]$env:RINGZ_BAUD)
$port.WriteTimeout = 5000
$port.Open()
try {
  $bytes = [IO.File]::ReadAllBytes($env:RINGZ_FILE)
  $port.Write($bytes, 0, $bytes.Length)
  Start-Sleep -Milliseconds 300
} finally { $port.Close() }
'sent'
`;

async function withTempFile<T>(data: Uint8Array, send: (file: string) => Promise<T>): Promise<T> {
  const file = path.join(tmpdir(), `ringz-print-${randomUUID()}.bin`);
  await writeFile(file, data);
  try {
    return await send(file);
  } finally {
    await unlink(file).catch(() => {});
  }
}

export async function printRaw(target: PrintTarget, data: Uint8Array, timeoutMs = 15000): Promise<void> {
  if (data.length === 0) throw new Error("Nothing to print.");
  if (data.length > MAX_BYTES) throw new Error("That job is too large to print.");
  switch (target.connection) {
    case "NETWORK": {
      const where = parseTarget(target.address);
      if (!where) throw new Error(`"${target.address}" isn't an IP address or host name.`);
      return sendTcp(where.host, where.port, data, timeoutMs);
    }
    case "OS":
      await withTempFile(data, (file) =>
        process.platform === "win32"
          ? powershell(WINDOWS_RAW, timeoutMs, { RINGZ_PRINTER: target.address, RINGZ_FILE: file })
          : run("lp", ["-d", target.address, "-o", "raw", file], timeoutMs),
      );
      return;
    case "SERIAL":
      if (process.platform === "win32") {
        await withTempFile(data, (file) => powershell(WINDOWS_SERIAL, timeoutMs, { RINGZ_PORT: target.address, RINGZ_BAUD: String(target.baudRate ?? 9600), RINGZ_FILE: file }));
        return;
      }
      await writeFile(target.address, data);
      return;
    case "USB":
      if (process.platform === "win32") {
        throw new Error("Windows can't print to a raw USB device without a driver. Add it as an OS printer (Generic / Text Only on its USB port) and print to that.");
      }
      await writeFile(target.address, data);
      return;
  }
}
