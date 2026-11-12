import "server-only";
import { randomBytes, randomInt } from "node:crypto";
import bcrypt from "bcryptjs";
import type { Prisma } from "@prisma/client";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { BUSINESS_SETTINGS_ID } from "@/lib/business-settings";
import { APP_TIME_ZONE } from "@/lib/dateRanges";
import { deviceLabel } from "@/lib/hardware/deviceLabel";
import { orderRef } from "../../lib/format";
import { defaultDisplayName, generatePin, PIN_ONLY_DOMAIN, pinProblem } from "../../lib/staffPins";
import type { HomeScreen, SystemRole } from "../../lib/staffRoles";
import type { CreateStaffInput, PinChoice, UpdateStaffInput } from "../../schemas/staff";
import { canTakeOrdersWhere } from "./orders";

// Settings › Staff (Part 6f Step 3; Administrator only — the actions check).
// Staff are users. Added here they sign in by PIN only (a placeholder login
// nobody knows). A PIN: 4 digits, unique in the business, not weak (unless
// the setting allows), bcrypt-hashed, a generated one shown once. Resetting
// a PIN or disabling someone ends every session they have (sessionVersion).
// Disabling keeps their history; their open orders go to someone else first.
// Every change is in the audit log — never a PIN itself.

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const OPEN = ["OPEN", "SENT", "SERVED"] as const;
const when = new Intl.DateTimeFormat("en-GB", { timeZone: APP_TIME_ZONE, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export type StaffRow = {
  id: string;
  firstName: string;
  lastName: string;
  displayName: string;
  image: string | null;
  colour: string | null;
  email: string | null;
  role: { id: string; name: string; systemRole: SystemRole | null; homeScreen: HomeScreen; isAdmin: boolean } | null;
  homeAreaId: string | null;
  homeStation: string | null;
  disabled: boolean;
  pin: "NONE" | "SET" | "OLD";
  // Their staff card's last characters ("…4F2A"), or null (Step 7d).
  card: string | null;
  // Training mode (Step 7f).
  training: boolean;
  lastLogin: string | null;
  lastDevice: string | null;
  openOrders: number;
};
export type StaffSettings = { allowWeakPins: boolean; staffSelfPin: boolean };
export type StaffPage = {
  staff: StaffRow[];
  roles: { id: string; name: string; homeScreen: HomeScreen }[];
  areas: { id: string; name: string }[];
  stations: { code: string; name: string }[];
  settings: StaffSettings;
};

export async function getStaffSettings(db: Prisma.TransactionClient | typeof prisma = prisma): Promise<StaffSettings> {
  const row = await db.businessSetting.findUnique({ where: { id: BUSINESS_SETTINGS_ID }, select: { restaurantAllowWeakPins: true, restaurantStaffSelfPin: true } });
  return { allowWeakPins: row?.restaurantAllowWeakPins ?? false, staffSelfPin: row?.restaurantStaffSelfPin ?? false };
}

export async function getStaffPage(): Promise<StaffPage> {
  const [users, roles, areas, stations, settings] = await Promise.all([
    prisma.user.findMany({
      where: { deletedAt: null },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        displayName: true,
        image: true,
        colour: true,
        email: true,
        pinOnly: true,
        cardLabel: true,
        trainingMode: true,
        homeAreaId: true,
        homeStation: true,
        disabledAt: true,
        lastLoginAt: true,
        lastDeviceId: true,
        userRole: { select: { id: true, name: true, systemRole: true, homeScreen: true, isSystem: true, deletedAt: true } },
        approvalPin: { select: { meetsRules: true } },
        _count: { select: { waitedOrders: { where: { status: { in: [...OPEN] }, deletedAt: null } } } },
      },
    }),
    prisma.role.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true, homeScreen: true } }),
    prisma.diningArea.findMany({ where: { deletedAt: null }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: { id: true, name: true } }),
    prisma.kitchenStation.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { code: true, name: true } }),
    getStaffSettings(),
  ]);
  const deviceIds = [...new Set(users.flatMap((u) => (u.lastDeviceId ? [u.lastDeviceId] : [])))];
  const devices = deviceIds.length ? await prisma.device.findMany({ where: { id: { in: deviceIds } }, select: { id: true, name: true, userAgent: true } }) : [];
  return {
    staff: users
      .map((u) => ({
        id: u.id,
        firstName: u.firstName,
        lastName: u.lastName,
        displayName: u.displayName || defaultDisplayName(u.firstName, u.lastName),
        image: u.image,
        colour: u.colour,
        email: u.pinOnly ? null : u.email,
        role: u.userRole && !u.userRole.deletedAt ? { id: u.userRole.id, name: u.userRole.name, systemRole: u.userRole.systemRole, homeScreen: u.userRole.homeScreen, isAdmin: u.userRole.isSystem } : null,
        homeAreaId: u.homeAreaId,
        homeStation: u.homeStation,
        disabled: !!u.disabledAt,
        pin: !u.approvalPin ? ("NONE" as const) : u.approvalPin.meetsRules ? ("SET" as const) : ("OLD" as const),
        card: u.cardLabel,
        training: u.trainingMode,
        lastLogin: u.lastLoginAt ? when.format(u.lastLoginAt) : null,
        lastDevice: u.lastDeviceId ? (deviceLabel(devices.find((d) => d.id === u.lastDeviceId) ?? null) ?? "A device since forgotten") : null,
        openOrders: u._count.waitedOrders,
      }))
      .sort((a, b) => Number(a.disabled) - Number(b.disabled)),
    roles,
    areas,
    stations,
    settings,
  };
}

// ---- PINs

// One PIN change at a time across the business (so two can't take the same
// one at once): the settings row, locked.
async function lockPins(tx: Prisma.TransactionClient) {
  await tx.$queryRaw`SELECT id FROM BusinessSetting WHERE id = ${BUSINESS_SETTINGS_ID} FOR UPDATE`;
}
const ensureSettingsRow = () => prisma.businessSetting.upsert({ where: { id: BUSINESS_SETTINGS_ID }, create: { id: BUSINESS_SETTINGS_ID }, update: {}, select: { id: true } });

// Does anyone else (not deleted) have this PIN? Each PIN is a bcrypt hash,
// so each one is compared.
async function pinTaken(tx: Prisma.TransactionClient, pin: string, exceptUserId: string | null): Promise<boolean> {
  const pins = await tx.approvalPin.findMany({ where: { user: { deletedAt: null }, ...(exceptUserId ? { userId: { not: exceptUserId } } : {}) }, select: { pinHash: true } });
  for (const saved of pins) if (await bcrypt.compare(pin, saved.pinHash)) return true;
  return false;
}

// The PIN to give someone (typed, or generated), checked: the rules, then
// free. Inside the PIN lock.
async function choosePin(tx: Prisma.TransactionClient, choice: PinChoice, userId: string | null): Promise<Result<{ pin: string; generated: boolean }>> {
  const { allowWeakPins } = await getStaffSettings(tx);
  if ("generate" in choice) {
    const pin = await generatePin((p) => pinTaken(tx, p, userId), () => randomInt(10_000) / 10_000);
    return pin ? { ok: true, pin, generated: true } : { ok: false, error: "Couldn't find a free PIN. Type one instead." };
  }
  const problem = pinProblem(choice.pin, { allowWeak: allowWeakPins });
  if (problem) return { ok: false, error: problem };
  if (await pinTaken(tx, choice.pin, userId)) return { ok: false, error: "Someone already has that PIN. Pick another." };
  return { ok: true, pin: choice.pin, generated: false };
}

async function writePin(tx: Prisma.TransactionClient, userId: string, pin: string) {
  const pinHash = await bcrypt.hash(pin, 10);
  await tx.approvalPin.upsert({
    where: { userId },
    create: { userId, pinHash, meetsRules: true },
    update: { pinHash, meetsRules: true, failedAttempts: 0, lockedUntil: null },
  });
}

// ---- Roles, areas, stations given

async function checkPlacement(tx: Prisma.TransactionClient, input: { roleId: string; homeAreaId: string | null; homeStation: string | null }): Promise<string | null> {
  if (!(await tx.role.count({ where: { id: input.roleId, deletedAt: null } }))) return "That role has been deleted. Reload the page.";
  if (input.homeAreaId && !(await tx.diningArea.count({ where: { id: input.homeAreaId, deletedAt: null } }))) return "That area has been deleted. Reload the page.";
  if (input.homeStation && !(await tx.kitchenStation.count({ where: { code: input.homeStation } }))) return "That kitchen station has been removed. Reload the page.";
  return null;
}
const activeAdmins = (tx: Prisma.TransactionClient, exceptUserId: string) =>
  tx.user.count({ where: { id: { not: exceptUserId }, deletedAt: null, disabledAt: null, userRole: { isSystem: true, deletedAt: null } } });

// ---- Add, edit

export async function createStaff(input: CreateStaffInput, actorId: string): Promise<Result<{ id: string; pin: string | null }>> {
  await ensureSettingsRow();
  const placeholder = await bcrypt.hash(randomBytes(32).toString("base64url"), 10);
  return prisma.$transaction(async (tx) => {
    await lockPins(tx);
    const problem = await checkPlacement(tx, input);
    if (problem) return { ok: false as const, error: problem };
    const chosen = await choosePin(tx, input.pin, null);
    if (!chosen.ok) return chosen;
    const user = await tx.user.create({
      data: {
        firstName: input.firstName,
        lastName: input.lastName,
        displayName: input.displayName || null,
        // Signs in by PIN only: an address nobody can use, a password nobody knows.
        email: `staff-${randomBytes(9).toString("hex")}@${PIN_ONLY_DOMAIN}`,
        password: placeholder,
        pinOnly: true,
        roleId: input.roleId,
        colour: input.colour,
        homeAreaId: input.homeAreaId,
        homeStation: input.homeStation,
      },
      select: { id: true },
    });
    await writePin(tx, user.id, chosen.pin);
    const role = await tx.role.findUniqueOrThrow({ where: { id: input.roleId }, select: { name: true } });
    await writeAudit({ userId: actorId, action: "staff.create", entityType: "User", entityId: user.id, meta: { name: `${input.firstName} ${input.lastName}`, role: role.name, pin: chosen.generated ? "generated" : "typed" } }, tx);
    return { ok: true as const, id: user.id, pin: chosen.generated ? chosen.pin : null };
  });
}

export async function updateStaff(input: UpdateStaffInput, actorId: string): Promise<Result> {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findFirst({
      where: { id: input.id, deletedAt: null },
      select: { firstName: true, lastName: true, displayName: true, roleId: true, colour: true, homeAreaId: true, homeStation: true, userRole: { select: { isSystem: true } } },
    });
    if (!user) return { ok: false as const, error: "That person has been removed. Reload the page." };
    const problem = await checkPlacement(tx, input);
    if (problem) return { ok: false as const, error: problem };
    // Someone must always be the Administrator.
    const toRole = await tx.role.findUniqueOrThrow({ where: { id: input.roleId }, select: { isSystem: true, name: true } });
    if (user.userRole?.isSystem && !toRole.isSystem && (await activeAdmins(tx, input.id)) === 0) {
      return { ok: false as const, error: "The last Administrator can't be moved to another role." };
    }
    const next = {
      firstName: input.firstName,
      lastName: input.lastName,
      displayName: input.displayName || null,
      roleId: input.roleId,
      colour: input.colour,
      homeAreaId: input.homeAreaId,
      homeStation: input.homeStation,
    };
    const changed = (Object.keys(next) as (keyof typeof next)[]).filter((k) => next[k] !== user[k]);
    if (!changed.length) return { ok: true as const };
    await tx.user.update({ where: { id: input.id }, data: next });
    await writeAudit(
      { userId: actorId, action: "staff.update", entityType: "User", entityId: input.id, meta: { name: `${input.firstName} ${input.lastName}`, changed: Object.fromEntries(changed.map((k) => [k, { from: user[k], to: next[k] }])) } },
      tx,
    );
    return { ok: true as const };
  });
}

// ---- PIN set / reset (the Administrator), own PIN (staff, if allowed)

export async function setStaffPin(input: { id: string; pin: PinChoice }, actorId: string): Promise<Result<{ pin: string | null; reset: boolean }>> {
  await ensureSettingsRow();
  return prisma.$transaction(async (tx) => {
    await lockPins(tx);
    const user = await tx.user.findFirst({ where: { id: input.id, deletedAt: null }, select: { firstName: true, lastName: true, approvalPin: { select: { userId: true } } } });
    if (!user) return { ok: false as const, error: "That person has been removed. Reload the page." };
    const chosen = await choosePin(tx, input.pin, input.id);
    if (!chosen.ok) return chosen;
    const reset = !!user.approvalPin;
    await writePin(tx, input.id, chosen.pin);
    // A reset ends every session they have, on every device.
    if (reset) await tx.user.update({ where: { id: input.id }, data: { sessionVersion: { increment: 1 } } });
    await writeAudit(
      { userId: actorId, action: reset ? "staff.pin.reset" : "staff.pin.set", entityType: "User", entityId: input.id, meta: { name: `${user.firstName} ${user.lastName}`, pin: chosen.generated ? "generated" : "typed", sessionsEnded: reset } },
      tx,
    );
    return { ok: true as const, pin: chosen.generated ? chosen.pin : null, reset };
  });
}

export async function changeOwnPin(userId: string, input: { oldPin: string; pin: string }): Promise<Result> {
  await ensureSettingsRow();
  return prisma.$transaction(async (tx) => {
    await lockPins(tx);
    const settings = await getStaffSettings(tx);
    if (!settings.staffSelfPin) return { ok: false as const, error: "PINs are set by an Administrator (Settings › Staff)." };
    const saved = await tx.approvalPin.findUnique({ where: { userId }, select: { pinHash: true, lockedUntil: true } });
    if (!saved) return { ok: false as const, error: "You haven't a PIN yet. Ask an Administrator to set your first one." };
    if (saved.lockedUntil && saved.lockedUntil > new Date()) return { ok: false as const, error: "Too many wrong PINs. Try again in a few minutes." };
    if (!(await bcrypt.compare(input.oldPin, saved.pinHash))) return { ok: false as const, error: "Your current PIN isn't right." };
    const chosen = await choosePin(tx, { pin: input.pin, confirm: input.pin }, userId);
    if (!chosen.ok) return chosen;
    await writePin(tx, userId, chosen.pin);
    await writeAudit({ userId, action: "staff.pin.self", entityType: "User", entityId: userId, meta: {} }, tx);
    return { ok: true as const };
  });
}

// ---- Disable / enable

export type DisableResult = Result<{ transferred: number }> | { ok: false; error: string; needsTransfer: { orders: { id: string; ref: string; table: string | null }[]; to: { id: string; name: string }[] } };

// Disable: can't sign in, every session ends, history kept. Their open orders
// go to `transferTo` first — without one, the orders and who can take them
// come back for the screen to ask.
export async function disableStaff(input: { id: string; transferTo: string | null }, actorId: string): Promise<DisableResult> {
  if (input.id === actorId) return { ok: false, error: "You can't disable yourself." };
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findFirst({ where: { id: input.id, deletedAt: null }, select: { firstName: true, lastName: true, disabledAt: true, userRole: { select: { isSystem: true } } } });
    if (!user) return { ok: false as const, error: "That person has been removed. Reload the page." };
    if (user.disabledAt) return { ok: true as const, transferred: 0 };
    if (user.userRole?.isSystem && (await activeAdmins(tx, input.id)) === 0) return { ok: false as const, error: "The last Administrator can't be disabled." };
    const orders = await tx.order.findMany({ where: { waiterId: input.id, status: { in: [...OPEN] }, deletedAt: null }, select: { id: true, number: true, table: { select: { name: true } } } });
    if (orders.length && !input.transferTo) {
      const to = await tx.user.findMany({ where: { ...canTakeOrdersWhere(), id: { not: input.id } }, orderBy: { firstName: "asc" }, select: { id: true, firstName: true, lastName: true } });
      return {
        ok: false as const,
        error: `${user.firstName} has ${orders.length} open order${orders.length === 1 ? "" : "s"}. Give ${orders.length === 1 ? "it" : "them"} to someone else first.`,
        needsTransfer: { orders: orders.map((o) => ({ id: o.id, ref: orderRef(o.number), table: o.table?.name ?? null })), to: to.map((p) => ({ id: p.id, name: `${p.firstName} ${p.lastName}`.trim() })) },
      };
    }
    let to: { firstName: string; lastName: string } | null = null;
    if (orders.length && input.transferTo) {
      to = await tx.user.findFirst({ where: { ...canTakeOrdersWhere(), id: input.transferTo }, select: { firstName: true, lastName: true } });
      if (!to || input.transferTo === input.id) return { ok: false as const, error: "That person can't take the orders. Pick someone else." };
      await tx.order.updateMany({ where: { id: { in: orders.map((o) => o.id) } }, data: { waiterId: input.transferTo, version: { increment: 1 } } });
    }
    await tx.user.update({ where: { id: input.id }, data: { disabledAt: new Date(), sessionVersion: { increment: 1 } } });
    await writeAudit(
      {
        userId: actorId,
        action: "staff.disable",
        entityType: "User",
        entityId: input.id,
        meta: { name: `${user.firstName} ${user.lastName}`, ...(orders.length ? { transferred: orders.length, to: `${to!.firstName} ${to!.lastName}`.trim(), orders: orders.map((o) => o.id) } : {}) },
      },
      tx,
    );
    return { ok: true as const, transferred: orders.length };
  });
}

export async function enableStaff(id: string, actorId: string): Promise<Result> {
  const user = await prisma.user.findFirst({ where: { id, deletedAt: null }, select: { firstName: true, lastName: true, disabledAt: true } });
  if (!user) return { ok: false, error: "That person has been removed. Reload the page." };
  if (!user.disabledAt) return { ok: true };
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id }, data: { disabledAt: null } });
    await writeAudit({ userId: actorId, action: "staff.enable", entityType: "User", entityId: id, meta: { name: `${user.firstName} ${user.lastName}` } }, tx);
  });
  return { ok: true };
}

// ---- The PIN settings

export async function saveStaffSettings(input: StaffSettings, actorId: string): Promise<Result> {
  await prisma.$transaction(async (tx) => {
    const before = await getStaffSettings(tx);
    await tx.businessSetting.upsert({
      where: { id: BUSINESS_SETTINGS_ID },
      create: { id: BUSINESS_SETTINGS_ID, restaurantAllowWeakPins: input.allowWeakPins, restaurantStaffSelfPin: input.staffSelfPin },
      update: { restaurantAllowWeakPins: input.allowWeakPins, restaurantStaffSelfPin: input.staffSelfPin },
    });
    if (before.allowWeakPins !== input.allowWeakPins || before.staffSelfPin !== input.staffSelfPin)
      await writeAudit({ userId: actorId, action: "staff.settings", entityType: "BusinessSetting", entityId: BUSINESS_SETTINGS_ID, meta: { from: before, to: input } }, tx);
  });
  return { ok: true };
}
