import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { BUSINESS_SETTINGS_ID } from "@/lib/business-settings";
import { defaultDisplayName } from "../../lib/staffPins";
import { homeHref } from "../../lib/staffRoles";
import { resolveView, routesFor, type ServiceRoutes } from "../../lib/serviceRoutes";
import { afterRight, afterWrong, lockedFor, waitText, type GuessState } from "../../lib/pinLockout";
import type { PosStaff } from "../queries/posScreen";
import { checkUserPin, findByPin, WRONG_PIN } from "./approvalPins";
import { findByCard } from "./staffCard";
import { onShiftUserIds } from "./shifts";

// PIN-only entry (Part 6f Step 4). On a device an Administrator paired as a
// restaurant terminal (Settings › Devices), the sign-in page is the PIN
// screen: a PIN alone signs its person in (tapping a name first is
// optional), then they land on their home screen. Wrong PINs lock the
// device (lib/pinLockout: 30 s, rising to 5 minutes); each one is logged,
// never the PIN.

// Who can sign in by PIN: everyone active with a role and a PIN.
export const pinSignInWhere = (): Prisma.UserWhereInput => ({ deletedAt: null, disabledAt: null, userRole: { is: { deletedAt: null } } });

// The Kitchen screen (Part 6f Step 7c) signs in Kitchen staff and managers
// only: the Kitchen and Manager roles, the Administrator, and any role whose
// home is the kitchen display.
export const kitchenScreenWhere = (): Prisma.UserWhereInput => ({
  userRole: { is: { deletedAt: null, OR: [{ isSystem: true }, { systemRole: { in: ["KITCHEN", "MANAGER"] } }, { homeScreen: "KITCHEN" }] } },
});
export const KITCHEN_SCREEN_ONLY = "This is the kitchen screen: only Kitchen staff and managers sign in here.";

export type TerminalKind = "POS" | "KITCHEN" | "BAR";
// cards: someone has a staff card (Step 7d) — the hint mentions it.
export type PinLoginScreen = { staff: PosStaff[]; hideNames: boolean; clockOn: boolean; kind: TerminalKind; cards: boolean };

// The PIN screen's "on shift" list: everyone who can sign in by PIN, the most
// recently signed-in first (Step 6 narrows it to those clocked in) — or
// nobody, when the Administrator hides the names.
// On the Kitchen screen (Step 7c), only who may sign in there.
export async function getPinLoginScreen(deviceId: string | null = null): Promise<PinLoginScreen> {
  const [settings, device] = await Promise.all([
    prisma.businessSetting.findUnique({ where: { id: BUSINESS_SETTINGS_ID }, select: { restaurantPinHideNames: true, restaurantClockInOut: true } }),
    deviceId ? prisma.device.findUnique({ where: { id: deviceId }, select: { terminalRole: true } }) : null,
  ]);
  const hideNames = settings?.restaurantPinHideNames ?? false;
  const clockOn = settings?.restaurantClockInOut ?? false;
  const kind: TerminalKind = device?.terminalRole ?? "POS";
  const cards = (await prisma.user.count({ where: { ...pinSignInWhere(), cardHash: { not: null } } })) > 0;
  if (hideNames) return { staff: [], hideNames, clockOn, kind, cards };
  // Clock in / out on (Step 6): only who's on shift.
  const onShift = clockOn ? await onShiftUserIds() : null;
  const people = await prisma.user.findMany({
    where: { AND: [{ ...pinSignInWhere(), approvalPin: { isNot: null }, ...(onShift ? { id: { in: onShift } } : {}) }, kind === "KITCHEN" ? kitchenScreenWhere() : {}] },
    select: { id: true, firstName: true, lastName: true, displayName: true, colour: true, userRole: { select: { name: true } } },
    orderBy: [{ lastLoginAt: { sort: "desc", nulls: "last" } }, { firstName: "asc" }, { lastName: "asc" }],
    take: 60,
  });
  return {
    hideNames,
    clockOn,
    kind,
    cards,
    staff: people.map((u) => ({ id: u.id, name: u.displayName || defaultDisplayName(u.firstName, u.lastName), role: u.userRole?.name, colour: u.colour })),
  };
}

export type PinSignInResult =
  | { ok: true; user: { id: string; firstName: string; name: string } }
  | { ok: false; error: string; waitSeconds?: number };

type DeviceRow = { pinLogin: number | boolean; pinFailures: number; pinLockedUntil: Date | null; pinLockLevel: number; terminalRole: TerminalKind };

// The PIN (and the name, if one was tapped) typed on this device. Under a
// lock on the device's row, so guesses typed at once are counted one by one.
// `card` (Step 7d): a staff card read by the scanner, instead of the PIN —
// the same device lock-out (an unknown card is a wrong guess), the same log.
export const UNKNOWN_CARD = "That card isn't anyone's here.";
export async function pinSignIn(input: { deviceId: string; userId: string | null; pin: string; card?: string | null }, now = new Date()): Promise<PinSignInResult> {
  return prisma.$transaction(
    async (tx): Promise<PinSignInResult> => {
      const rows = await tx.$queryRaw<DeviceRow[]>`
        SELECT pinLogin, pinFailures, pinLockedUntil, pinLockLevel, terminalRole FROM \`Device\` WHERE id = ${input.deviceId} FOR UPDATE`;
      const device = rows[0];
      if (!device || !Number(device.pinLogin)) return { ok: false, error: "This device isn't a PIN terminal. Sign in with your email instead." };
      const state: GuessState = { failures: device.pinFailures, lockedUntil: device.pinLockedUntil, lockLevel: device.pinLockLevel };
      const wait = lockedFor(state, now);
      if (wait > 0) return { ok: false, error: waitText(wait), waitSeconds: wait };

      let found: { id: string; firstName: string } | null = null;
      let problem = WRONG_PIN;
      if (input.card) {
        found = await findByCard(input.card, pinSignInWhere(), tx);
        if (!found) problem = UNKNOWN_CARD;
      } else if (input.userId) {
        const person = await tx.user.findFirst({ where: { id: input.userId, ...pinSignInWhere() }, select: { id: true, firstName: true } });
        if (!person) return { ok: false, error: "That person can't sign in here. Type your PIN." };
        const checked = await checkUserPin(tx, person.id, input.pin, person.firstName);
        if (checked.ok) found = person;
        else problem = checked.error;
      } else {
        const match = await findByPin(input.pin, pinSignInWhere());
        if (match.kind === "one") found = match.user;
        // Only a PIN from before the rules (Step 3) can be shared.
        else if (match.kind === "shared") return { ok: false, error: "Someone else has that PIN too — tap your name first, or ask an Administrator for a new PIN." };
      }

      if (!found) {
        const next = afterWrong(state, now);
        await tx.device.update({ where: { id: input.deviceId }, data: { pinFailures: next.failures, pinLockedUntil: next.lockedUntil, pinLockLevel: next.lockLevel } });
        await writeAudit(
          { userId: null, action: "pin.signin.fail", entityType: "Device", entityId: input.deviceId, meta: { tapped: input.userId, failures: next.locked ? 5 : next.failures, lockedSeconds: next.locked, ...(input.card ? { method: "card" } : {}) } },
          tx,
        );
        if (next.locked) return { ok: false, error: waitText(next.locked), waitSeconds: next.locked };
        return { ok: false, error: problem === WRONG_PIN ? `${WRONG_PIN} Try again.` : problem };
      }

      // The Kitchen screen (Step 7c): a right PIN, but not someone who signs in
      // there — refused, logged, not counted as a guess.
      if (device.terminalRole === "KITCHEN" && !(await tx.user.count({ where: { id: found.id, ...kitchenScreenWhere() } }))) {
        await writeAudit({ userId: found.id, action: "pin.signin.refused", entityType: "Device", entityId: input.deviceId, meta: { reason: "KITCHEN_SCREEN" } }, tx);
        return { ok: false, error: KITCHEN_SCREEN_ONLY };
      }

      const fresh = afterRight();
      if (state.failures || state.lockedUntil || state.lockLevel)
        await tx.device.update({ where: { id: input.deviceId }, data: { pinFailures: fresh.failures, pinLockedUntil: fresh.lockedUntil, pinLockLevel: fresh.lockLevel } });
      await writeAudit({ userId: found.id, action: "pin.signin", entityType: "Device", entityId: input.deviceId, meta: { tapped: !!input.userId, ...(input.card ? { method: "card" } : {}) } }, tx);
      const named = await tx.user.findUniqueOrThrow({ where: { id: found.id }, select: { firstName: true, lastName: true, displayName: true } });
      return { ok: true, user: { id: found.id, firstName: named.firstName, name: named.displayName || defaultDisplayName(named.firstName, named.lastName) } };
    },
    { timeout: 20_000 },
  );
}

// Where someone lands after the PIN: their own home area or station
// (Settings › Staff) over their role's (Settings › Restaurant › Roles), in
// this device's view.
export async function staffHome(userId: string, routes: ServiceRoutes): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { homeAreaId: true, homeStation: true, userRole: { select: { deletedAt: true, homeScreen: true, homeAreaId: true, homeStation: true } } },
  });
  const role = user?.userRole && !user.userRole.deletedAt ? user.userRole : null;
  if (!role) return routes.tables();
  return homeHref({ homeScreen: role.homeScreen, homeAreaId: user?.homeAreaId ?? role.homeAreaId, homeStation: user?.homeStation ?? role.homeStation }, routes);
}

// Home on a device by its id (the PIN sign-in, the sign-in page, the
// proxy — which can't read the view through the page's cookies helper):
// in the device's own view, or the business's. A paired Kitchen screen
// (Step 7c) opens the kitchen display — the person's station, if theirs is
// the kitchen; a Bar terminal, Tables on its area with the bar tabs first.
export async function staffHomeOn(userId: string, deviceId: string | null): Promise<string> {
  const [business, device] = await Promise.all([
    prisma.businessSetting.findUnique({ where: { id: BUSINESS_SETTINGS_ID }, select: { restaurantInterface: true } }),
    deviceId ? prisma.device.findUnique({ where: { id: deviceId }, select: { restaurantInterface: true, pinLogin: true, terminalRole: true, homeAreaId: true } }) : null,
  ]);
  const routes = routesFor(resolveView(business, device));
  if (device?.pinLogin && device.terminalRole === "KITCHEN") {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { homeStation: true, userRole: { select: { homeScreen: true, homeStation: true } } } });
    const station = user?.homeStation ?? (user?.userRole?.homeScreen === "KITCHEN" ? user.userRole.homeStation : null);
    return homeHref({ homeScreen: "KITCHEN", homeAreaId: null, homeStation: station ?? null }, routes);
  }
  if (device?.pinLogin && device.terminalRole === "BAR") {
    // Its own area — or the Bartender's.
    const areaId = device.homeAreaId ?? (await prisma.role.findFirst({ where: { systemRole: "BARTENDER", deletedAt: null }, select: { homeAreaId: true } }))?.homeAreaId ?? null;
    return homeHref({ homeScreen: "BAR", homeAreaId: areaId, homeStation: null }, routes);
  }
  return staffHome(userId, routes);
}

// A signed-in visit to the sign-in page: a PIN terminal, or someone whose
// role is Service-level, goes to their home screen; others (the back
// office) to the dashboard. null: the dashboard.
export async function signedInLanding(userId: string, terminalId: string | null, routes: ServiceRoutes): Promise<string | null> {
  if (terminalId) return staffHomeOn(userId, terminalId);
  {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { userRole: { select: { accessLevel: true, deletedAt: true } } } });
    if (!user?.userRole || user.userRole.deletedAt || user.userRole.accessLevel !== "SERVICE") return null;
  }
  return staffHome(userId, routes);
}

// Settings › Devices (Administrator only): pair a device — as a PIN
// terminal, the Kitchen screen or a Bar terminal on an area (Step 7c) — or
// unpair it. Pairing clears its lock-out. Logged.
export async function setPinTerminal(
  input: { deviceId: string; on: boolean; kind?: TerminalKind; areaId?: string | null },
  actorId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const device = await prisma.device.findUnique({ where: { id: input.deviceId }, select: { pinLogin: true, name: true, terminalRole: true, homeAreaId: true } });
  if (!device) return { ok: false, error: "That device is no longer listed — refreshed." };
  const kind = input.kind ?? "POS";
  const areaId = kind === "BAR" ? (input.areaId ?? null) : null;
  if (areaId && !(await prisma.diningArea.count({ where: { id: areaId, deletedAt: null } }))) return { ok: false, error: "That area has been removed. Pick another." };
  if (device.pinLogin === input.on && (!input.on || (device.terminalRole === kind && device.homeAreaId === areaId))) return { ok: true };
  await prisma.$transaction(async (tx) => {
    const pairing = input.on && !device.pinLogin;
    await tx.device.update({
      where: { id: input.deviceId },
      data: input.on
        ? { pinLogin: true, terminalRole: kind, homeAreaId: areaId, ...(pairing ? { pairedAt: new Date(), pinFailures: 0, pinLockedUntil: null, pinLockLevel: 0 } : {}) }
        : { pinLogin: false, pairedAt: null, terminalRole: "POS", homeAreaId: null },
    });
    const action = !input.on ? "device.pin.unpair" : pairing ? "device.pin.pair" : "device.terminal.change";
    await writeAudit({ userId: actorId, action, entityType: "Device", entityId: input.deviceId, meta: { name: device.name, kind: input.on ? kind : null, areaId } }, tx);
  });
  return { ok: true };
}

export async function setPinHideNames(hide: boolean, actorId: string): Promise<{ ok: true }> {
  await prisma.$transaction(async (tx) => {
    const before = await tx.businessSetting.findUnique({ where: { id: BUSINESS_SETTINGS_ID }, select: { restaurantPinHideNames: true } });
    if ((before?.restaurantPinHideNames ?? false) === hide) return;
    await tx.businessSetting.upsert({ where: { id: BUSINESS_SETTINGS_ID }, create: { id: BUSINESS_SETTINGS_ID, restaurantPinHideNames: hide }, update: { restaurantPinHideNames: hide } });
    await writeAudit({ userId: actorId, action: "staff.settings", entityType: "BusinessSetting", entityId: BUSINESS_SETTINGS_ID, meta: { from: { hidePinNames: !hide }, to: { hidePinNames: hide } } }, tx);
  });
  return { ok: true };
}
