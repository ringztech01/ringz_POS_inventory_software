import { z } from "zod";
import { CODE_PAGES, type CodePage } from "@/lib/hardware/escpos";
import { MAX_COPIES } from "@/lib/hardware/assignments";

// Settings › Printers input. The server re-checks everything (the role keys
// and that printers exist) in the actions.

export const PRINTER_NAME_MAX = 80;
export const BAUD_RATES = [2400, 4800, 9600, 19200, 38400, 57600, 115200] as const;

const id = z.string().trim().min(1).max(191);

const address = z.string().trim().min(1, "Enter the printer's address.").max(255);

export const printerSchema = z
  .object({
    name: z.string().trim().min(1, "Give the printer a name.").max(PRINTER_NAME_MAX, `Keep the name to ${PRINTER_NAME_MAX} characters.`),
    connection: z.enum(["OS", "USB", "NETWORK", "SERIAL"], { message: "Choose how it's connected." }),
    address,
    paperWidth: z.union([z.literal(58), z.literal(80)], { message: "Paper is 58 or 80 mm." }),
    codePage: z.enum(Object.keys(CODE_PAGES) as [CodePage, ...CodePage[]], { message: "Choose a code page." }),
    cut: z.enum(["FULL", "PARTIAL", "NONE"], { message: "Choose how it cuts." }),
    openDrawer: z.boolean(),
    drawerPin: z.union([z.literal(2), z.literal(5)]).default(2),
    baudRate: z
      .number()
      .int()
      .refine((rate) => (BAUD_RATES as readonly number[]).includes(rate), "Choose a baud rate.")
      .default(9600),
    model: z.string().trim().max(120).nullish(),
    identity: z
      .object({ vendorId: z.string().max(8).optional(), productId: z.string().max(8).optional(), serial: z.string().max(120).optional(), osName: z.string().max(255).optional(), mac: z.string().max(32).optional() })
      .nullish(),
  })
  .superRefine((value, ctx) => {
    const bad = (message: string) => ctx.addIssue({ code: "custom", message, path: ["address"] });
    if (value.connection === "NETWORK" && !/^[A-Za-z0-9.-]{1,253}(:\d{1,5})?$/.test(value.address)) bad("Enter an IP address or host name, like 192.168.1.50 or 192.168.1.50:9100.");
    if (value.connection === "SERIAL" && !/^(COM\d{1,3}|\/dev\/[\w.-]+)$/i.test(value.address)) bad("Enter a serial port, like COM3 or /dev/ttyUSB0.");
  });

export type PrinterInput = z.infer<typeof printerSchema>;
export type PrinterField = keyof z.input<typeof printerSchema>;

// The assignment grid: one row per role; no printer = not assigned.
export const assignmentsSchema = z.object({
  rows: z
    .array(
      z.object({
        role: z.string().trim().min(1).max(40),
        printerId: id.nullable(),
        fallbackPrinterId: id.nullable(),
        copies: z.number().int().min(1).max(MAX_COPIES).default(1),
      }),
    )
    .max(60),
});

export const deviceSchema = z.object({
  id,
  name: z.string().trim().max(PRINTER_NAME_MAX).transform((v) => v || null),
  overrides: z.array(z.object({ role: z.string().trim().min(1).max(40), printerId: id.nullable() })).max(10),
});
