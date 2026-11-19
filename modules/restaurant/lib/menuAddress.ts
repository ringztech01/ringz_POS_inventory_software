// The address the digital menu's QR codes open (Part 8 Step 2): the server
// on the restaurant's network, as a guest's phone on the Wi-Fi reaches it.
// Pure: the server reads the network cards and the port, this picks from them.

import { isLinkLocal, lanAddresses, type NetworkCard } from "@/lib/lanAddresses";

export { isPrivateIpv4, type NetworkCard } from "@/lib/lanAddresses";
// "ip": a network card's address; "name": the PC's own name (<name>.local);
// "app": the app's own name on the Wi-Fi (ringzpos.local, 6g follow-up 5) —
// it follows the PC when its IP changes.
export type AddressChoice = { url: string; label: string; kind: "ip" | "name" | "app" };

const withPort = (host: string, port: number | null) => `http://${host}${port && port !== 80 ? `:${port}` : ""}`;

// The addresses a phone on the Wi-Fi could use: the app's own name first
// when it's answering (`appName`), each real network card's IPv4 (private
// ranges first), then the PC's name on the network (<name>.local — iPhones
// open it; some Android phones can't).
export function addressChoices(cards: Record<string, NetworkCard[] | undefined>, hostname: string, port: number | null, appName: string | null = null): AddressChoice[] {
  const choices: AddressChoice[] = [];
  if (appName) choices.push({ url: withPort(appName, port), label: `${appName} (recommended: keeps working if the IP changes)`, kind: "app" });
  for (const { address, card } of lanAddresses(cards)) choices.push({ url: withPort(address, port), label: `${address} (${card})`, kind: "ip" });
  const name = hostname.trim().toLowerCase().replace(/\.local$/, "");
  if (/^[a-z0-9-]{1,63}$/.test(name)) choices.push({ url: withPort(`${name}.local`, port), label: `${name}.local (the PC's name)`, kind: "name" });
  return choices;
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
};
const isIpHost = (host: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(host);

// The saved address against what this PC is now (6g follow-up 5):
//   ok      it's one of this PC's addresses (or a name it answers to)
//   moved   an IP this PC no longer has, or another PC's .local name — the
//           printed codes don't open; `suggested` is what to save instead
//   other   a domain name or https address the app can't check
//   none    nothing saved yet
export type AddressCheck = { state: "ok" | "moved" | "other" | "none"; suggested: string | null };
export function checkMenuAddress(saved: string | null, choices: readonly AddressChoice[]): AddressCheck {
  const suggested = (choices.find((c) => c.kind === "app") ?? choices.find((c) => c.kind === "ip"))?.url ?? null;
  if (!saved) return { state: "none", suggested };
  if (choices.some((c) => c.url === saved)) return { state: "ok", suggested };
  const host = hostOf(saved);
  if (isIpHost(host) || host.endsWith(".local")) return { state: "moved", suggested: suggested === saved ? null : suggested };
  return { state: "other", suggested };
}

// For a .local address, the same with this PC's IP instead (`ip`), for the
// printed line under each code: a phone that can't open .local names types
// it. Null: the address is already an IP (or there's no IP to give).
export function ipFallback(saved: string, ip: string | null): string | null {
  if (!ip || !hostOf(saved).endsWith(".local")) return null;
  try {
    const url = new URL(saved);
    url.hostname = ip;
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

export type ParsedAddress = { ok: true; url: string } | { ok: false; error: string };

// What an admin typed or picked → "http://host[:port]" (no path, no slash at
// the end). Refused: not http(s), a path or query, this machine only
// (localhost, 127.x, 0.0.0.0) or a link-local address — a phone can't open those.
export function parseMenuAddress(input: string): ParsedAddress {
  const text = input.trim();
  if (!text) return { ok: false, error: "Enter the server's address, e.g. http://192.168.1.20:3000." };
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`);
  } catch {
    return { ok: false, error: "That isn't an address. Use one like http://192.168.1.20:3000." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, error: "The address must start with http:// or https://." };
  if (url.username || url.password || (url.pathname && url.pathname !== "/") || url.search || url.hash) {
    return { ok: false, error: "Just the server's address and port, with nothing after it (e.g. http://192.168.1.20:3000)." };
  }
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.startsWith("127.") || host === "0.0.0.0" || host === "[::1]" || host === "::1") {
    return { ok: false, error: "That address only works on this computer. Use the address phones on the Wi-Fi reach it at." };
  }
  if (isLinkLocal(host)) return { ok: false, error: "169.254.x.x means this card isn't on a network. Use the address on the restaurant's Wi-Fi." };
  if (url.toString().length > 200) return { ok: false, error: "That address is too long." };
  return { ok: true, url: `${url.protocol}//${url.host}` };
}

// A table's or point's menu link.
export function menuLink(base: string, qrToken: string): string {
  return `${base}/menu/${qrToken}`;
}
