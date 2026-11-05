import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { bridgeSecret } from "./bridgeSecret";

// Starts the hardware bridge (desktop/bridge/server.ts) as a child of the
// app server — called once from instrumentation.ts when the server starts
// (next dev / next start), never in a build. Node runs the bridge's
// TypeScript directly (type stripping: Node 22.18+ / 23.6+).
//
//   the secret         lib/hardware/bridgeSecret.ts — derived from the
//                      app's login secret (or BRIDGE_SECRET), handed to
//                      the bridge in its environment; nothing to set up
//   it exits           started again after 1s, 2s, 4s … (at most 30s); a run
//                      of a minute resets the wait. Exit 78 (no secret) and
//                      75 (its port is taken — another bridge) aren't retried.
//   the server stops   the bridge stops with it (its stdin pipe closes)

const MIN_NODE = [22, 18] as const;
const NO_RETRY = new Set([75, 78]);

type BridgeState = { child: ChildProcess | null; stopping: boolean; delay: number; startedAt: number };
const globalState = globalThis as typeof globalThis & { __ringzBridge?: BridgeState };

const log = (message: string) => console.log(`[bridge] ${message}`);

function nodeSupportsTypeStripping(): boolean {
  const [major, minor] = process.versions.node.split(".").map(Number);
  return major > MIN_NODE[0] || (major === MIN_NODE[0] && minor >= MIN_NODE[1]);
}

export function startBridge(): void {
  // Once per server process (a dev reload re-runs register()).
  if (globalState.__ringzBridge) return;
  const secret = bridgeSecret();
  if (!secret) {
    log("No NEXTAUTH_SECRET (or BRIDGE_SECRET) in .env to secure the bridge with — printers are off.");
    return;
  }
  if (!nodeSupportsTypeStripping()) {
    log(`Node ${process.versions.node} can't run the bridge — it needs Node ${MIN_NODE.join(".")} or later. Printers are off.`);
    return;
  }
  const state: BridgeState = { child: null, stopping: false, delay: 1000, startedAt: 0 };
  globalState.__ringzBridge = state;
  const entry = path.join(process.cwd(), "desktop", "bridge", "server.ts");

  const launch = () => {
    state.startedAt = Date.now();
    const child = spawn(process.execPath, [entry], { env: { ...process.env, BRIDGE_SECRET: secret }, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    state.child = child;
    child.stdout?.on("data", (chunk: Buffer) => chunk.toString().trimEnd().split(/\r?\n/).forEach(log));
    child.stderr?.on("data", (chunk: Buffer) => chunk.toString().trimEnd().split(/\r?\n/).forEach(log));
    child.on("exit", (code) => {
      state.child = null;
      if (state.stopping) return;
      if (code !== null && NO_RETRY.has(code)) {
        log(code === 75 ? "Its port is in use — another bridge is already running; using that one." : "Not restarting (see above).");
        return;
      }
      if (Date.now() - state.startedAt > 60_000) state.delay = 1000;
      log(`Stopped (exit ${code ?? "signal"}) — starting again in ${state.delay / 1000}s.`);
      setTimeout(launch, state.delay).unref();
      state.delay = Math.min(state.delay * 2, 30_000);
    });
  };
  launch();

  // Next handles its own shutdown signals; when the process goes the bridge
  // is killed here, and its stdin pipe closing stops it even if this can't run.
  process.once("exit", () => {
    state.stopping = true;
    state.child?.kill();
  });
}
