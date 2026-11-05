import { columns, EscPos, lineWidth, type CodePage, type Cut } from "./escpos";

// The test ticket (Settings › Printers › Test print): the printer's name and
// connection, a ruler for the paper width, the code page's characters, the
// time, then its cut. Never kicks the drawer (that has its own test, Step 5).

export type TestPrintTarget = { name: string; connection: string; address: string; paperWidth: number; codePage: CodePage; cut: Cut };

export function testPrintBytes(printer: TestPrintTarget, when: string): Uint8Array {
  const width = lineWidth(printer.paperWidth);
  const ruler = "0123456789".repeat(Math.ceil(width / 10)).slice(0, width);
  return new EscPos(printer.codePage)
    .align("center")
    .bold(true)
    .size(2, 2)
    .line("TEST PRINT")
    .size(1, 1)
    .bold(false)
    .line("RingzPOS")
    .feed(1)
    .align("left")
    .line(columns("Printer", printer.name, width))
    .line(columns("Connection", printer.connection, width))
    .line(columns("Address", printer.address, width))
    .line(columns("Paper", `${printer.paperWidth} mm · ${width} chars`, width))
    .line(columns("Code page", printer.codePage, width))
    .feed(1)
    .line(ruler)
    .line("-".repeat(width))
    .line("ABCDEFGHIJKLMNOPQRSTUVWXYZ")
    .line("abcdefghijklmnopqrstuvwxyz 0123456789")
    .line("Naira: ₦1,500.00  é ü ñ")
    .bold(true)
    .line("Bold text")
    .bold(false)
    .size(1, 2)
    .line("Tall text")
    .size(1, 1)
    .feed(1)
    .align("center")
    .line(when)
    .line("If you can read this, it works.")
    .cut(printer.cut)
    .bytes();
}
