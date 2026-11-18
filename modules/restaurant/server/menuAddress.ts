import "server-only";
import { hostname, networkInterfaces } from "node:os";
import { headers } from "next/headers";
import { addressChoices, type AddressChoice } from "../lib/menuAddress";

// The addresses this server could be reached at from a phone on the Wi-Fi
// (Digital menu › QR codes, Part 8 Step 2): its network cards and its name,
// on the port this request came in on (the app's port).
export async function detectedMenuAddresses(): Promise<AddressChoice[]> {
  const list = await headers();
  const host = list.get("x-forwarded-host") ?? list.get("host") ?? "";
  const portText = host.match(/:(\d+)$/)?.[1] ?? process.env.PORT ?? "";
  const port = portText ? Number(portText) : null;
  return addressChoices(networkInterfaces(), hostname(), port && Number.isFinite(port) ? port : null);
}
