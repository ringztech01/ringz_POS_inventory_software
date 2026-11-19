// This PC's addresses on the shop's or restaurant's network: each real
// network card's IPv4, private ranges first. Pure — the caller passes
// os.networkInterfaces(). Used by the menu's address (Digital menu › QR codes)
// and the app's name on the Wi-Fi (lib/hardware/mdnsResponder.ts), so both
// agree on which address is "this PC".

export type NetworkCard = { address: string; family: string | number; internal: boolean; netmask?: string };
export type LanAddress = { address: string; netmask: string; card: string };

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
export const isLinkLocal = (ip: string) => ip.startsWith("169.254.");

export function lanAddresses(cards: Record<string, NetworkCard[] | undefined>): LanAddress[] {
  const out: LanAddress[] = [];
  for (const [card, list] of Object.entries(cards)) {
    if (VIRTUAL.test(card)) continue;
    for (const entry of list ?? []) {
      if (!isIpv4(entry.family) || entry.internal || isLinkLocal(entry.address)) continue;
      out.push({ address: entry.address, netmask: entry.netmask ?? "255.255.255.0", card });
    }
  }
  return out.sort((a, b) => Number(isPrivateIpv4(b.address)) - Number(isPrivateIpv4(a.address)) || a.address.localeCompare(b.address, "en", { numeric: true }));
}
