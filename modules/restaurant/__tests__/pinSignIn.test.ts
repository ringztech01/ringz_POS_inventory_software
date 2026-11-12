// Run with: npx tsx --test modules/restaurant/__tests__/pinSignIn.test.ts
// Part 6f Step 4, without a database: the device lock-out (5 wrong → 30 s,
// rising to 5 minutes; a right PIN or a quiet spell starts over), the
// recovery code (shape, typing slack), and — from the source — that a PIN
// terminal takes no email, password or recovery code, the PIN pad signs in
// at the 4th digit, and pairing and the recovery code are the
// Administrator's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterRight, afterWrong, lockedFor, lockSeconds, waitText, type GuessState } from "../lib/pinLockout";
import { formatRecoveryCode, normaliseRecoveryCode, RECOVERY_ALPHABET, recoveryCodeFrom } from "../../../lib/auth/recoveryCode";

const t0 = new Date("2026-11-11T12:00:00Z");
const at = (ms: number) => new Date(t0.getTime() + ms);

test("lock-out: four wrong PINs are counted, the fifth locks for 30 s; then 60 s, 2 min, 5 min — never longer", () => {
  let s: GuessState = { failures: 0, lockedUntil: null, lockLevel: 0 };
  let now = 0;
  const locks: number[] = [];
  for (let round = 0; round < 5; round++) {
    for (let i = 1; i <= 5; i++) {
      const next = afterWrong(s, at(now));
      if (i < 5) assert.equal(next.locked, null, `try ${i}`);
      else locks.push(next.locked!);
      s = next;
    }
    assert.equal(lockedFor(s, at(now)), locks.at(-1));
    now += locks.at(-1)! * 1000 + 1000; // wait it out (but not long enough to be forgotten)
    assert.equal(lockedFor(s, at(now)), 0);
  }
  assert.deepEqual(locks, [30, 60, 120, 300, 300]);
  assert.equal(lockSeconds(99), 300);
});

test("lock-out: a right PIN starts over; so do 15 quiet minutes since the last lock", () => {
  let s: GuessState = { failures: 0, lockedUntil: null, lockLevel: 0 };
  for (let i = 0; i < 5; i++) s = afterWrong(s, t0);
  assert.equal(s.lockLevel, 1);
  assert.deepEqual(afterRight(), { failures: 0, lockedUntil: null, lockLevel: 0 });

  const later = at(30_000 + 16 * 60_000);
  let q = s;
  for (let i = 0; i < 5; i++) q = afterWrong(q, later);
  assert.equal((q as ReturnType<typeof afterWrong>).locked, 30, "forgotten: the short lock again");
  assert.equal(waitText(30), "Too many attempts · wait 30 seconds");
  assert.equal(waitText(105), "Too many attempts · wait 1:45");
});

test("recovery code: 20 characters in groups of five, no I/L/O/U; typed back with slack", () => {
  const bytes = Uint8Array.from({ length: 20 }, (_, i) => i * 13 + 7);
  const code = recoveryCodeFrom(bytes);
  assert.match(code, /^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){3}$/);
  const plain = code.replace(/-/g, "");
  assert.equal(normaliseRecoveryCode(code), plain);
  assert.equal(normaliseRecoveryCode(` ${code.toLowerCase().replace(/-/g, " ")} `), plain);
  assert.equal(normaliseRecoveryCode("OOOOO-IIIII-LLLLL-00000"), "00000111111111100000");
  assert.equal(normaliseRecoveryCode("ABCDE-FGHJK"), null, "too short");
  assert.equal(normaliseRecoveryCode("UUUUU-UUUUU-UUUUU-UUUUU"), null, "U isn't in the alphabet");
  assert.equal(normaliseRecoveryCode(42), null);
  assert.equal(formatRecoveryCode("0123456789ABCDEFGHJK"), "01234-56789-ABCDE-FGHJK");
  assert.equal(RECOVERY_ALPHABET.length, 32);
  assert.throws(() => recoveryCodeFrom(new Uint8Array(5)));
});

const src = (file: string) => readFileSync(file, "utf8");

test("a PIN terminal takes no email, password or recovery code; the recovery code is used up once", () => {
  const auth = src("auth.ts");
  assert.equal((auth.match(/if \(await pinTerminalId\(\)\) return null;/g) ?? []).length, 2, "the password and recovery providers both refuse on a terminal");
  assert.match(auth, /id: "recovery"/);
  const recovery = src("lib/auth/recovery.ts");
  assert.match(recovery, /FOR UPDATE/);
  assert.match(recovery, /data: \{ recoveryCodeHash: null \}/, "used up");
  assert.match(recovery, /userRole: \{ is: \{ isSystem: true, deletedAt: null \} \}/, "an active Administrator's email only");
  assert.match(src("lib/auth/pinTerminal.ts"), /isModuleEnabled\("restaurant"\)/, "module off: no terminals (retail unchanged)");
  const page = src("app/page.tsx");
  assert.match(page, /if \(terminal\) return <PinLoginPage \/>;/);
});

test("the PIN screen: the 4th digit signs in; the server checks the device; pairing and the code are the Administrator's", () => {
  const pad = src("modules/restaurant/components/pos/PinSwitch.tsx");
  assert.match(pad, /const maxDigits = signIn \? 4 : PIN_MAX;/);
  assert.match(pad, /pin\.length >= maxDigits \? 0 : PAUSE_MS/);
  const service = src("modules/restaurant/server/services/pinSignIn.ts");
  assert.match(service, /SELECT pinLogin, pinFailures, pinLockedUntil, pinLockLevel, terminalRole FROM \\`Device\\` WHERE id = \$\{input\.deviceId\} FOR UPDATE/);
  assert.match(service, /if \(!device \|\| !Number\(device\.pinLogin\)\) return/);
  assert.match(service, /action: "pin\.signin\.fail"/);
  const actions = src("modules/restaurant/server/actions/pinSignIn.ts");
  const chunks = actions.split(/\nexport async function /).slice(1);
  assert.deepEqual(chunks.map((c) => c.slice(0, c.indexOf("("))), ["signInByPin", "setPinTerminal", "savePinHideNames", "makeRecoveryCode"]);
  for (const chunk of chunks.slice(1)) assert.match(chunk, /const admin = await requireAdministrator\(\);\s*if \(admin\.error !== undefined\) return/);
  assert.doesNotMatch(chunks[0], /requireAdministrator|getCurrentUserPermissions/, "signed out: the device is what's checked");
});

test("device roles (Step 7c): the Kitchen screen refuses others without counting a guess; every home goes through the device", () => {
  const service = src("modules/restaurant/server/services/pinSignIn.ts");
  assert.match(service, /if \(device\.terminalRole === "KITCHEN" && !\(await tx\.user\.count\(\{ where: \{ id: found\.id, \.\.\.kitchenScreenWhere\(\) \} \}\)\)\) \{/);
  assert.match(service, /action: "pin\.signin\.refused"/);
  assert.match(src("modules/restaurant/server/actions/pinSignIn.ts"), /staffHomeOn\(result\.user\.id, deviceId\)/);
  assert.match(src("proxy.ts"), /staffHomeOn\(userId, /);
  assert.match(src("app/(dashboard)/layout.tsx"), /staffHomeOn\(current\.userId, await currentDeviceId\(\)\)/);
  assert.match(src("modules/restaurant/components/kitchen/KitchenBoard.tsx"), /\{terminal && \(\s*<button\s*type="button"\s*data-kds-lock/);
});

test("staff cards (Step 7d): a reader's burst never lands on the pad as a PIN; the PIN screen and the POS switch take a card", () => {
  const pad = src("modules/restaurant/components/pos/PinSwitch.tsx");
  assert.match(pad, /const BURST_MS = 45;/);
  assert.match(pad, /if \(t < burst\.until \|\| \(burst\.pending\.length && gap < BURST_MS\)\) \{/);
  const login = src("modules/restaurant/components/pos/PinLogin.tsx");
  assert.match(login, /<ScanProvider>\s*<PinLoginScreen \{\.\.\.props\} \/>\s*<\/ScanProvider>/);
  assert.match(login, /void signIn\(\{ card: code \}\)/);
  assert.match(src("modules/restaurant/components/pos/PosSession.tsx"), /\{ enabled: switching \|\| locked \}/);
  assert.match(src("modules/restaurant/server/actions/pos.ts"), /const found = await findByCard\(card, canTakeOrdersWhere\(\)\);/);
  const cards = src("modules/restaurant/server/actions/staffCard.ts");
  assert.equal((cards.match(/const admin = await requireAdministrator\(\);\s*if \(admin\.error !== undefined\) return/g) ?? []).length, 2);
  assert.match(src("lib/auth/staffCard.ts"), /createHmac\("sha256", key\)\.update\(code\)/, "a keyed hash, never the code");
});
