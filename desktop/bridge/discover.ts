import { discoverLocal } from "./discoverLocal.ts";
import { scanNetwork } from "./discoverNetwork.ts";
import type { DiscoveryResult } from "./types.ts";

// Everything the bridge can find: this machine's printers (OS queues, raw
// USB, serial) and, unless asked not to, the LAN's port-9100 printers. Each
// source on its own — one failing is reported in `errors`, the rest still
// come back.
export async function discover(options: { network?: boolean; timeoutMs?: number } = {}): Promise<DiscoveryResult> {
  const started = Date.now();
  const [local, network] = await Promise.allSettled([
    discoverLocal(),
    options.network === false ? Promise.resolve({ printers: [], subnets: [] }) : scanNetwork({ timeoutMs: options.timeoutMs }),
  ]);
  const errors: string[] = [];
  const printers = [];
  let subnets: string[] = [];
  if (local.status === "fulfilled") {
    printers.push(...local.value.printers);
    errors.push(...local.value.errors);
  } else errors.push(`Local printers: ${(local.reason as Error).message}`);
  if (network.status === "fulfilled") {
    printers.push(...network.value.printers);
    subnets = network.value.subnets;
  } else errors.push(`Network scan: ${(network.reason as Error).message}`);
  return { printers, errors, subnets, tookMs: Date.now() - started };
}
