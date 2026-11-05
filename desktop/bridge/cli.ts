import { discover } from "./discover.ts";
import { parseTarget, probePrinter } from "./discoverNetwork.ts";
import type { DiscoveredPrinter } from "./types.ts";

// The bridge's discovery from a terminal, without the HTTP service:
//   node desktop/bridge/cli.ts                 everything (local + LAN scan)
//   node desktop/bridge/cli.ts --local         this machine only
//   node desktop/bridge/cli.ts 192.168.1.50    one network printer (status, model)

function table(printers: DiscoveredPrinter[]) {
  const rows = printers.map((p) => [p.name, p.connection, p.address, p.model ?? "—", p.statusDetail ? `${p.status} (${p.statusDetail})` : p.status]);
  const head = ["Name", "Connection", "Address", "Model", "Status"];
  const widths = head.map((h, i) => Math.min(48, Math.max(h.length, ...rows.map((r) => r[i].length))));
  const line = (cols: string[]) => cols.map((c, i) => (c.length > widths[i] ? `${c.slice(0, widths[i] - 1)}…` : c.padEnd(widths[i]))).join("  ");
  console.log(line(head));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const row of rows) console.log(line(row));
}

const arg = process.argv[2];
if (arg && arg !== "--local") {
  const target = parseTarget(arg);
  if (!target) {
    console.error("Give an IP address or host name, like 192.168.1.50 or 192.168.1.50:9100.");
    process.exit(2);
  }
  table([await probePrinter(target.host, target.port)]);
} else {
  const result = await discover({ network: arg !== "--local" });
  table(result.printers);
  console.log(`\n${result.printers.length} found in ${result.tookMs} ms${result.subnets.length ? ` · scanned ${result.subnets.join(", ")}` : ""}`);
  for (const error of result.errors) console.log(`! ${error}`);
}
