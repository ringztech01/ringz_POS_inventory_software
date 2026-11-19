import "server-only";
import { hostname, networkInterfaces } from "node:os";
import { headers } from "next/headers";
import { lanAddresses } from "@/lib/lanAddresses";
import { mdnsStatus } from "@/lib/hardware/mdnsResponder";
import { addressChoices, type AddressChoice } from "../lib/menuAddress";

// The addresses this server could be reached at from a phone on the Wi-Fi
// (Digital menu › QR codes, Part 8 Step 2): the app's own name while it's
// answering on the network (ringzpos.local, 6g follow-up 5), its network
// cards and the PC's name, on the port this request came in on (the app's port).
export async function detectedMenuAddresses(): Promise<AddressChoice[]> {
  const list = await headers();
  const host = list.get("x-forwarded-host") ?? list.get("host") ?? "";
  const portText = host.match(/:(\d+)$/)?.[1] ?? process.env.PORT ?? "";
  const port = portText ? Number(portText) : null;
  const mdns = mdnsStatus();
  return addressChoices(networkInterfaces(), hostname(), port && Number.isFinite(port) ? port : null, mdns.running ? mdns.name : null);
}

// This PC's IP on the Wi-Fi now, for the line printed under a .local code.
export function currentLanIp(): string | null {
  return lanAddresses(networkInterfaces())[0]?.address ?? null;
}
