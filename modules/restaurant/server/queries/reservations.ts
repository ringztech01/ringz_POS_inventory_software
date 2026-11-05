import "server-only";
import type { ReservationStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { orderRef } from "../../lib/format";
import { isLate } from "../../lib/reservations";
import { appDayBounds, formatAppTime } from "../../lib/time";
import { byFloorOrder } from "./tables";

export type ReservationRow = {
  id: string;
  // "19:30" on the app's clock.
  time: string;
  guestName: string;
  guestPhone: string;
  partySize: number;
  tableName: string;
  areaName: string;
  status: ReservationStatus;
  // Booked and more than 30 minutes past its time.
  late: boolean;
  customerName: string | null;
  // Set once seated.
  orderId: string | null;
  orderRef: string | null;
};

// One app-calendar day's bookings, every status, by time. Bookings on a
// deleted table or area are left out.
export async function getReservationsForDay(day: string): Promise<ReservationRow[]> {
  const { start, end } = appDayBounds(day);
  const now = new Date();
  const rows = await prisma.reservation.findMany({
    where: { deletedAt: null, startsAt: { gte: start, lt: end }, table: { deletedAt: null, area: { deletedAt: null } } },
    select: {
      id: true,
      startsAt: true,
      guestName: true,
      guestPhone: true,
      partySize: true,
      status: true,
      customer: { select: { name: true } },
      table: { select: { name: true, area: { select: { name: true } } } },
      order: { select: { id: true, number: true } },
    },
    orderBy: [{ startsAt: "asc" }, { createdAt: "asc" }],
  });
  return rows.map((row) => ({
    id: row.id,
    time: formatAppTime(row.startsAt),
    guestName: row.guestName,
    guestPhone: row.guestPhone,
    partySize: row.partySize,
    tableName: row.table.name,
    areaName: row.table.area.name,
    status: row.status,
    late: isLate(row, now),
    customerName: row.customer?.name ?? null,
    orderId: row.order?.id ?? null,
    orderRef: row.order ? orderRef(row.order.number) : null,
  }));
}

export type BookingTable = { id: string; name: string; seats: number; areaId: string; areaName: string };
export type BookingCustomer = { id: string; name: string; phone: string };

// The New booking form's choices: active tables (floor order) and customers
// other than the walk-in one.
export async function getBookingOptions(): Promise<{ tables: BookingTable[]; customers: BookingCustomer[] }> {
  const [tables, customers] = await Promise.all([
    prisma.table.findMany({
      where: { deletedAt: null, area: { deletedAt: null } },
      select: { id: true, name: true, seats: true, areaId: true, area: { select: { name: true, sortOrder: true, createdAt: true } } },
    }),
    prisma.customer.findMany({
      where: { deletedAt: null, isDefault: false },
      select: { id: true, name: true, phoneNumber: true },
      orderBy: { name: "asc" },
    }),
  ]);
  return {
    tables: tables
      .sort(byFloorOrder)
      .map((t) => ({ id: t.id, name: t.name, seats: t.seats, areaId: t.areaId, areaName: t.area.name })),
    customers: customers.map((c) => ({ id: c.id, name: c.name, phone: c.phoneNumber })),
  };
}
