// The address the digital menu's QR codes open (Part 8 Step 2): the server
// on the restaurant's network, as a guest's phone on the Wi-Fi reaches it.
// Pure: the server reads the network cards and the port, this picks from them.

export type NetworkCard = { address: string; family: string | number; internal: boolean };
export type AddressChoice = { url: string; label: string; kind: "ip" | "name" };

// Adapters that aren't the restaurant's network: virtual switches (WSL,
// Hyper-V, Docker, VirtualBox, VMware), VPNs and Bluetooth.
const VIRTUAL = /vethernet|wsl|hyper-v|docker|virtualbox|vmware|vbox|loopback|bluetooth|tailscale|zerotier|vpn|tap-|tun/i;

const isIpv4 = (family: string | number) => family === "IPv4" || family === 4;
const octets = (ip: string) => ip.split(".").map(Number);

// Private ranges a LAN uses (10/8, 172.16/12, 192.168/16).
export function isPrivateIpv4(ip: string): boolean {
  const [a, b] = octets(ip);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

// 169.254.x.x: the PC gave itself an address because no network did.
const isLinkLocal = (ip: string) => ip.startsWith("169.254.");

const withPort = (host: string, port: number | null) => `http://${host}${port && port !== 80 ? `:${port}` : ""}`;

// The addresses a phone on the Wi-Fi could use: each real network card's
// IPv4 (private ranges first), then the PC's name on the network
// (<name>.local — iPhones open it; some Android phones can't).
export function addressChoices(cards: Record<string, NetworkCard[] | undefined>, hostname: string, port: number | null): AddressChoice[] {
  const ips: { ip: string; card: string }[] = [];
  for (const [card, list] of Object.entries(cards)) {
    if (VIRTUAL.test(card)) continue;
    for (const entry of list ?? []) {
      if (!isIpv4(entry.family) || entry.internal || isLinkLocal(entry.address)) continue;
      ips.push({ ip: entry.address, card });
    }
  }
  ips.sort((a, b) => Number(isPrivateIpv4(b.ip)) - Number(isPrivateIpv4(a.ip)) || a.ip.localeCompare(b.ip, "en", { numeric: true }));
  const choices: AddressChoice[] = ips.map(({ ip, card }) => ({ url: withPort(ip, port), label: `${ip} (${card})`, kind: "ip" }));
  const name = hostname.trim().toLowerCase().replace(/\.local$/, "");
  if (/^[a-z0-9-]{1,63}$/.test(name)) choices.push({ url: withPort(`${name}.local`, port), label: `${name}.local (the PC's name)`, kind: "name" });
  return choices;
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
