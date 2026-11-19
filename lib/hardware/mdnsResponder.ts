// Server only (node:dgram): started by instrumentation.ts, read by the QR
// codes page. Like the bridge launcher, no "server-only" import: the
// instrumentation hook loads it outside React's server environment.
import dgram from "node:dgram";
import { networkInterfaces } from "node:os";
import { lanAddresses } from "@/lib/lanAddresses";
import { addressFor, answerA, APP_MDNS_NAME, asksFor, MDNS_GROUP, MDNS_PORT, parseQuery } from "./mdns";

// Answers "where is ringzpos.local?" on the Wi-Fi with this PC's address
// (6g follow-up 5), while the server runs — started once with it
// (instrumentation.ts), like the hardware bridge. Node's own UDP sockets, no
// packages. It shares port 5353 with Windows' own answers for the PC's name.
// If it can't start, the app runs as before; the QR codes screen says so and
// offers the IP instead.

type MdnsState = { running: boolean; name: string; error: string | null; socket: dgram.Socket | null };
const KEY = Symbol.for("ringz.mdns");
const holder = globalThis as unknown as { [KEY]?: MdnsState };

export function mdnsStatus(): { running: boolean; name: string; error: string | null } {
  const state = holder[KEY];
  return { running: !!state?.running, name: state?.name ?? APP_MDNS_NAME, error: state?.error ?? null };
}

const mine = () => lanAddresses(networkInterfaces());

export function startMdnsResponder(name = APP_MDNS_NAME): void {
  if (holder[KEY]?.socket) return;
  const state: MdnsState = { running: false, name, error: null, socket: null };
  holder[KEY] = state;
  const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
  state.socket = socket;

  // Join the group on each of this PC's networks (a card may come and go).
  const joined = new Set<string>();
  const join = () => {
    for (const { address } of mine()) {
      if (joined.has(address)) continue;
      try {
        socket.addMembership(MDNS_GROUP, address);
        joined.add(address);
      } catch {
        // Not on this card (yet): tried again on the next answer.
      }
    }
  };
  const announce = (ip: string) => {
    try {
      socket.setMulticastInterface(ip);
      socket.send(answerA(name, ip), MDNS_PORT, MDNS_GROUP);
    } catch {
      // A card that's just gone: the next question gets an answer anyway.
    }
  };

  socket.on("error", (error) => {
    state.running = false;
    state.error = error.message;
    console.warn(`[mdns] ${name} isn't answering on the network: ${error.message}`);
    try {
      socket.close();
    } catch {}
    state.socket = null;
  });

  socket.on("message", (message, from) => {
    const query = parseQuery(message);
    if (!query || !query.questions.some((q) => asksFor(q, name))) return;
    const ip = addressFor(from.address, mine());
    if (!ip) return;
    join();
    // A plain DNS client asking from another port gets a reply to itself
    // (RFC 6762 §6.7); otherwise the answer goes to the group, unless the
    // question asked for a reply to the asker only.
    if (from.port !== MDNS_PORT) {
      socket.send(answerA(name, ip, { legacy: { id: query.id } }), from.port, from.address);
      return;
    }
    if (query.questions.some((q) => asksFor(q, name) && q.unicast)) socket.send(answerA(name, ip), from.port, from.address);
    else announce(ip);
  });

  socket.bind(MDNS_PORT, () => {
    try {
      socket.setMulticastTTL(255);
      socket.setMulticastLoopback(true);
    } catch {}
    join();
    state.running = true;
    console.log(`[mdns] answering for ${name} on ${[...joined].join(", ") || "no network yet"}`);
    // Say so twice at the start, as RFC 6762 §8.3 asks.
    for (const { address } of mine()) announce(address);
    setTimeout(() => mine().forEach(({ address }) => announce(address)), 1000).unref();
  });
  socket.unref();
}
