import "server-only";
import { prisma } from "@/lib/db";
import { addDays, todayInAppZone } from "@/lib/dateRanges";
import { deviceLabel } from "@/lib/hardware/deviceLabel";
import { CATEGORIES, describeAudit, describeDrawer, describeVoid, type AuditCategory } from "../../lib/auditEvents";
import { orderRef } from "../../lib/format";
import { defaultDisplayName } from "../../lib/staffPins";

// The audit view (Part 6f Step 7e): one list, newest first, from the audit
// log (sign-ins, failed PINs, overrides, PINs and cards, staff, till, devices),
// voided order lines and the cash drawer's openings — for a date range on the
// app's calendar, one person and one kind if asked. The newest LIMIT.

export const AUDIT_LIMIT = 500;
const PER_SOURCE = 1500;

export type AuditFilter = { from: string; to: string; userId: string | null; category: AuditCategory | null };
export type AuditRow = { id: string; at: string; who: string | null; whoId: string | null; category: AuditCategory; what: string; detail: string | null; where: string | null };
export type AuditView = {
  filter: AuditFilter;
  rows: AuditRow[];
  counts: Record<AuditCategory, number>;
  more: boolean;
  people: { id: string; name: string }[];
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
// Today back to six days ago, unless the page asks for other days (to ≥ from).
export function auditFilter(input: { from?: unknown; to?: unknown; user?: unknown; type?: unknown }, now = new Date()): AuditFilter {
  const today = todayInAppZone(now);
  let to = typeof input.to === "string" && DAY.test(input.to) ? input.to : today;
  let from = typeof input.from === "string" && DAY.test(input.from) ? input.from : addDays(to, -6);
  if (from > to) [from, to] = [to, from];
  const category = typeof input.type === "string" && (CATEGORIES as readonly string[]).includes(input.type) ? (input.type as AuditCategory) : null;
  const userId = typeof input.user === "string" && input.user.length > 0 && input.user.length <= 191 ? input.user : null;
  return { from, to, userId, category };
}

// Midnight in Lagos (UTC+1, no daylight saving).
const startOf = (day: string) => new Date(`${day}T00:00:00.000+01:00`);

export async function getAuditView(filter: AuditFilter): Promise<AuditView> {
  const range = { gte: startOf(filter.from), lt: startOf(addDays(filter.to, 1)) };
  const [logs, voids, drawer, people] = await Promise.all([
    prisma.auditLog.findMany({
      where: { createdAt: range, ...(filter.userId ? { userId: filter.userId } : {}) },
      orderBy: { createdAt: "desc" },
      take: PER_SOURCE,
      select: { id: true, createdAt: true, userId: true, action: true, entityType: true, entityId: true, meta: true },
    }),
    prisma.orderItem.findMany({
      where: { cancelledAt: range, deletedAt: null, kitchenStatus: { not: "NEW" }, ...(filter.userId ? { cancelledById: filter.userId } : {}) },
      orderBy: { cancelledAt: "desc" },
      take: PER_SOURCE,
      select: { id: true, cancelledAt: true, cancelledById: true, quantity: true, cancelReason: true, product: { select: { name: true } }, order: { select: { number: true } } },
    }),
    prisma.drawerEvent.findMany({
      where: { createdAt: range, ...(filter.userId ? { userId: filter.userId } : {}) },
      orderBy: { createdAt: "desc" },
      take: PER_SOURCE,
      select: { id: true, createdAt: true, userId: true, reason: true, note: true, refLabel: true, deviceId: true },
    }),
    prisma.user.findMany({ where: { deletedAt: null }, orderBy: [{ firstName: "asc" }, { lastName: "asc" }], select: { id: true, firstName: true, lastName: true, displayName: true } }),
  ]);

  // Names for everyone the rows mention (the deleted too), and the devices.
  const ids = new Set<string>();
  const deviceIds = new Set<string>();
  for (const l of logs) {
    if (l.userId) ids.add(l.userId);
    const m = (l.meta ?? {}) as Record<string, unknown>;
    for (const k of ["approvedById", "forUserId", "from", "tapped"]) if (typeof m[k] === "string") ids.add(m[k] as string);
    if (l.entityType === "Device" && l.entityId) deviceIds.add(l.entityId);
  }
  for (const v of voids) if (v.cancelledById) ids.add(v.cancelledById);
  for (const d of drawer) {
    if (d.userId) ids.add(d.userId);
    if (d.deviceId) deviceIds.add(d.deviceId);
  }
  const [users, devices] = await Promise.all([
    ids.size ? prisma.user.findMany({ where: { id: { in: [...ids] } }, select: { id: true, firstName: true, lastName: true, displayName: true } }) : [],
    deviceIds.size ? prisma.device.findMany({ where: { id: { in: [...deviceIds] } }, select: { id: true, name: true, userAgent: true } }) : [],
  ]);
  const names = new Map(users.map((u) => [u.id, u.displayName || defaultDisplayName(u.firstName, u.lastName)]));
  const name = (id: unknown) => (typeof id === "string" ? (names.get(id) ?? null) : null);
  const places = new Map(devices.map((d) => [d.id, deviceLabel(d) ?? "A device"]));
  const place = (id: string | null) => (id ? (places.get(id) ?? null) : null);

  const all: AuditRow[] = [];
  for (const l of logs) {
    const d = describeAudit(l.action, l.meta, name);
    if (!d) continue;
    all.push({ id: `log:${l.id}`, at: l.createdAt.toISOString(), who: name(l.userId), whoId: l.userId, category: d.category, what: d.what, detail: d.detail, where: l.entityType === "Device" ? place(l.entityId) : null });
  }
  for (const v of voids) {
    const d = describeVoid({ quantity: v.quantity, item: v.product.name, orderRef: orderRef(v.order.number), reason: v.cancelReason });
    all.push({ id: `void:${v.id}`, at: v.cancelledAt!.toISOString(), who: name(v.cancelledById), whoId: v.cancelledById, category: d.category, what: d.what, detail: d.detail, where: null });
  }
  for (const e of drawer) {
    const d = describeDrawer(e);
    all.push({ id: `drawer:${e.id}`, at: e.createdAt.toISOString(), who: name(e.userId), whoId: e.userId, category: d.category, what: d.what, detail: d.detail, where: place(e.deviceId) });
  }
  all.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  const counts = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<AuditCategory, number>;
  for (const r of all) counts[r.category] += 1;
  const shown = filter.category ? all.filter((r) => r.category === filter.category) : all;
  return {
    filter,
    rows: shown.slice(0, AUDIT_LIMIT),
    counts,
    more: shown.length > AUDIT_LIMIT,
    people: people.map((p) => ({ id: p.id, name: p.displayName || defaultDisplayName(p.firstName, p.lastName) })),
  };
}
