import { execFile } from "node:child_process";

// Runs an OS command and returns what it printed. A command that's missing,
// fails or takes too long rejects with a short reason.
// `env`: extra environment variables (how values reach a script safely —
// never pasted into its text).
export function run(command: string, args: readonly string[], timeoutMs = 15000, env: Record<string, string> = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, [...args], { timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024, encoding: "utf8", env: { ...process.env, ...env } }, (error, stdout, stderr) => {
      if (error) {
        const why = (error as NodeJS.ErrnoException).code === "ENOENT" ? `${command} isn't available` : (stderr || error.message).toString().trim().split(/\r?\n/)[0];
        reject(new Error(why || `${command} failed`));
        return;
      }
      resolve(stdout);
    });
  });
}

// A PowerShell script, run without a profile and with UTF-8 output (printer
// names can have any characters). Passed encoded, so nothing needs quoting.
export function powershell(script: string, timeoutMs = 20000, env: Record<string, string> = {}): Promise<string> {
  const full = `[Console]::OutputEncoding = [Text.Encoding]::UTF8\n$ErrorActionPreference = 'SilentlyContinue'\n${script}`;
  const encoded = Buffer.from(full, "utf16le").toString("base64");
  return run("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], timeoutMs, env);
}
