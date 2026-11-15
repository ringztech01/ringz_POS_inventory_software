// Restaurant Reports, Step 11: 90 days of data — about 50,000 settled
// orders with their lines, sales, payments, tips, refunds, voids, waste,
// shifts, tills and drawer opens — seeded in SQL (INSERT … SELECT from a
// numbers table). For reportPerf.dbtest.ts, on a throwaway copy only; every
// row's id starts perf_.
import { prisma } from "@/lib/db";
import { addDays } from "@/lib/dateRanges";
import { businessDay, businessDayStart } from "../server/queries/reports/filters";

export const ORDERS = 50_000;
export const DAYS = 90;
const WAITERS = 10;
const TABLES = 30;
const PRODUCTS = 40;

// Each statement timed (REPORT_PERF_VERBOSE=1 prints them).
const run = async (sql: string) => {
  const t0 = performance.now();
  const rows = await prisma.$executeRawUnsafe(sql);
  if (process.env.REPORT_PERF_VERBOSE === "1") console.log(`  ${Math.round(performance.now() - t0)} ms · ${rows} rows · ${sql.replace(/\s+/g, " ").slice(0, 70)}`);
  return rows;
};
const sqlDate = (d: Date) => d.toISOString().slice(0, 23).replace("T", " ");

export async function seedReportPerf() {
  const warehouseId = (await prisma.warehouse.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
  const customerId = (await prisma.customer.findFirstOrThrow({ where: { isDefault: true }, select: { id: true } })).id;
  const roleId = (await prisma.role.findFirstOrThrow({ where: { isSystem: true, deletedAt: null }, select: { id: true } })).id;
  const brandId = (await prisma.brand.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
  const unitId = (await prisma.unit.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
  const categoryId = (await prisma.category.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
  const stations = await prisma.kitchenStation.findMany({ where: { deletedAt: null }, orderBy: { createdAt: "asc" }, select: { id: true } });
  const kitchen = stations[0].id;
  const bar = (stations[1] ?? stations[0]).id;
  const today = businessDay(new Date(), 0);
  const base = businessDayStart(addDays(today, -(DAYS - 1)), 0);

  await run(`CREATE TABLE perf_n (n INT PRIMARY KEY)`);
  await run(`INSERT INTO perf_n (n) SELECT a.d + b.d * 10 + c.d * 100 + d.d * 1000 + e.d * 10000 FROM ${[1, 2, 3, 4, 5].map((_, i) => `(SELECT 0 d UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9) ${"abcde"[i]}`).join(", ")}`);

  // People, places, menu (prices 1,500–11,250; cost 35%, one item without).
  await run(`INSERT INTO \`User\` (id, firstName, lastName, email, password, roleId, updatedAt) SELECT CONCAT('perf_u_', n), CONCAT('Waiter', n), 'Perf', CONCAT('perf-', n, '@check.test'), 'x', '${roleId}', NOW(3) FROM perf_n WHERE n < ${WAITERS}`);
  await run(`INSERT INTO DiningArea (id, name, warehouseId, updatedAt) SELECT CONCAT('perf_a_', n), CONCAT('Perf area ', n), '${warehouseId}', NOW(3) FROM perf_n WHERE n < 3`);
  await run(`INSERT INTO \`Table\` (id, name, areaId, seats, qrToken, updatedAt) SELECT CONCAT('perf_t_', n), CONCAT('PF', n), CONCAT('perf_a_', n % 3), 4, CONCAT('perfqr', n), NOW(3) FROM perf_n WHERE n < ${TABLES}`);
  await run(`INSERT INTO MenuGroup (id, name, department, updatedAt) VALUES ('perf_mg_f', 'Perf mains', 'FOOD', NOW(3)), ('perf_mg_b', 'Perf drinks', 'BAR', NOW(3))`);
  await run(`INSERT INTO Product (id, name, code, price, cost, categoryId, brandId, unitId, taxType, productType, menuGroupId, stationId, updatedAt)
    SELECT CONCAT('perf_p_', n), CONCAT('Perf dish ', n), CONCAT('PERF-', n, '-', UNIX_TIMESTAMP()), 1500 + n * 250, CASE WHEN n = ${PRODUCTS - 1} THEN NULL ELSE ROUND((1500 + n * 250) * 0.35, 2) END,
      '${categoryId}', '${brandId}', '${unitId}', 'EXCLUSIVE', 'MENU_ITEM', IF(n < 30, 'perf_mg_f', 'perf_mg_b'), IF(n < 30, '${kitchen}', '${bar}'), NOW(3)
    FROM perf_n WHERE n < ${PRODUCTS}`);

  // Each order: 2 lines; 1 in 20 with 10% off; 1 in 10 a takeaway, a tab or a delivery; 1 in 250 training.
  await run(`CREATE TABLE perf_o AS SELECT n,
      n % ${DAYS} AS day,
      DATE_ADD(DATE_ADD('${sqlDate(base)}', INTERVAL n % ${DAYS} DAY), INTERVAL (600 + (n * 37) % 720) MINUTE) AS closedAt,
      n % ${PRODUCTS} AS p1, (n * 7 + 3) % ${PRODUCTS} AS p2, 1 + n % 3 AS q1, 1 + n % 2 AS q2,
      CASE n % 10 WHEN 0 THEN 'TAKEAWAY' WHEN 1 THEN 'BAR_TAB' WHEN 2 THEN 'DELIVERY' ELSE 'DINE_IN' END AS type
    FROM perf_n WHERE n < ${ORDERS}`);
  await run(`ALTER TABLE perf_o ADD PRIMARY KEY (n), ADD COLUMN s1 DECIMAL(12,2), ADD COLUMN s2 DECIMAL(12,2), ADD COLUMN disc DECIMAL(12,2), ADD COLUMN total DECIMAL(12,2)`);
  await run(`UPDATE perf_o SET s1 = q1 * (1500 + p1 * 250), s2 = q2 * (1500 + p2 * 250)`);
  await run(`UPDATE perf_o SET disc = IF(n % 20 = 0, ROUND((s1 + s2) * 0.1, 2), 0)`);
  await run(`UPDATE perf_o SET total = s1 + s2 - disc`);

  await run(`INSERT INTO Sale (id, reference, customerId, warehouseId, date, status, discount, grandTotal, paid, due, paymentStatus, createdById, createdAt, updatedAt)
    SELECT CONCAT('perf_s_', n), CONCAT('PERF-', n), '${customerId}', '${warehouseId}', DATE(closedAt), 'RECEIVED', disc, total, total, 0, 'PAID', CONCAT('perf_u_', FLOOR(n / ${DAYS}) % ${WAITERS}), closedAt, NOW(3) FROM perf_o`);
  await run(`INSERT INTO \`Order\` (id, type, status, training, tableId, warehouseId, waiterId, guests, saleId, openedAt, closedAt, discountType, discountValue, discountById, updatedAt)
    SELECT CONCAT('perf_o_', n), type, 'BILLED', n % 250 = 0, IF(type = 'DINE_IN', CONCAT('perf_t_', n % ${TABLES}), NULL), '${warehouseId}', CONCAT('perf_u_', FLOOR(n / ${DAYS}) % ${WAITERS}), 1 + n % 6, CONCAT('perf_s_', n),
      DATE_SUB(closedAt, INTERVAL 25 + n % 70 MINUTE), closedAt, IF(disc > 0, 'PERCENT', NULL), IF(disc > 0, 10, 0), IF(disc > 0, CONCAT('perf_u_', FLOOR(n / ${DAYS}) % ${WAITERS}), NULL), NOW(3) FROM perf_o`);
  for (const k of [1, 2]) {
    await run(`INSERT INTO SaleItem (id, saleId, productId, quantity, saleUnit, netUnitPrice, subtotal) SELECT CONCAT('perf_si_', n, '_${k}'), CONCAT('perf_s_', n), CONCAT('perf_p_', p${k}), q${k}, 'pc', 1500 + p${k} * 250, s${k} FROM perf_o`);
    await run(`INSERT INTO OrderItem (id, orderId, productId, quantity, unitPrice, kitchenStatus, stationId, sentAt, readyAt, unitCost, modifiers, createdAt, updatedAt)
      SELECT CONCAT('perf_i_', n, '_${k}'), CONCAT('perf_o_', n), CONCAT('perf_p_', p${k}), q${k}, 1500 + p${k} * 250, 'SERVED', IF(p${k} < 30, '${kitchen}', '${bar}'),
        DATE_SUB(closedAt, INTERVAL 20 + n % 60 MINUTE), DATE_SUB(closedAt, INTERVAL 5 + n % 15 MINUTE),
        IF(p${k} = ${PRODUCTS - 1}, NULL, ROUND((1500 + p${k} * 250) * 0.35, 4)),
        ${k === 1 ? `IF(n % 4 = 0, JSON_ARRAY(JSON_OBJECT('group', 'Extras', 'name', 'Extra meat', 'price', '500.00')), NULL)` : "NULL"},
        DATE_SUB(closedAt, INTERVAL 30 MINUTE), NOW(3) FROM perf_o`);
  }
  // Voids: 1 in 33 orders had a third line voided, a manager approving.
  await run(`INSERT INTO OrderItem (id, orderId, productId, quantity, unitPrice, kitchenStatus, stationId, sentAt, cancelledAt, cancelReason, cancelledById, createdAt, updatedAt)
    SELECT CONCAT('perf_iv_', n), CONCAT('perf_o_', n), CONCAT('perf_p_', (n + 11) % ${PRODUCTS}), 1, 1500 + ((n + 11) % ${PRODUCTS}) * 250, 'PENDING', '${kitchen}',
      DATE_SUB(closedAt, INTERVAL 20 MINUTE), DATE_SUB(closedAt, INTERVAL 15 MINUTE), 'Wrong item · approved by Waiter0', CONCAT('perf_u_', FLOOR(n / ${DAYS}) % ${WAITERS}), DATE_SUB(closedAt, INTERVAL 30 MINUTE), NOW(3)
    FROM perf_o WHERE n % 33 = 0`);
  await run(`INSERT INTO AuditLog (id, businessId, userId, action, entityType, entityId, meta, createdAt)
    SELECT CONCAT('perf_al_', n), 'default', CONCAT('perf_u_', FLOOR(n / ${DAYS}) % ${WAITERS}), 'override.void', 'OrderItem', CONCAT('perf_iv_', n), JSON_OBJECT('approvedById', 'perf_u_0'), DATE_SUB(closedAt, INTERVAL 15 MINUTE) FROM perf_o WHERE n % 33 = 0 AND n % 2 = 0`);

  // Tills: two a day (a device each), opened 09:00, closed 23:00.
  await run(`INSERT INTO Device (id, name, createdAt) VALUES ('perf_dev_0', 'Perf till 1', NOW(3)), ('perf_dev_1', 'Perf till 2', NOW(3))`);
  await run(`INSERT INTO TillSession (id, deviceId, openedById, openedAt, \`float\`, closedById, closedAt)
    SELECT CONCAT('perf_ts_', d.n, '_', k.n), CONCAT('perf_dev_', k.n), 'perf_u_0', DATE_ADD(DATE_ADD('${sqlDate(base)}', INTERVAL d.n DAY), INTERVAL 480 MINUTE), 20000, 'perf_u_0', DATE_ADD(DATE_ADD('${sqlDate(base)}', INTERVAL d.n DAY), INTERVAL 1320 MINUTE)
    FROM perf_n d JOIN perf_n k ON k.n < 2 WHERE d.n < ${DAYS}`);
  // Settlements and payments: cash (1 in 3) at that day's till.
  await run(`INSERT INTO OrderSettlement (id, orderId, idempotencyKey, saleId, amount, tip, \`change\`, version, closedOrder, createdById, createdAt)
    SELECT CONCAT('perf_st_', n), CONCAT('perf_o_', n), CONCAT('perf-', n), CONCAT('perf_s_', n), total, IF(n % 5 = 0, 500, 0), 0, 1, 1, CONCAT('perf_u_', FLOOR(n / ${DAYS}) % ${WAITERS}), closedAt FROM perf_o`);
  await run(`INSERT INTO SalePayment (id, saleId, amount, paymentType, date, createdById, tillSessionId, createdAt, updatedAt)
    SELECT CONCAT('perf_pay_', n), CONCAT('perf_s_', n), total, ELT(1 + n % 3, 'CASH', 'CARD', 'BANK_TRANSFER'), DATE(closedAt), CONCAT('perf_u_', FLOOR(n / ${DAYS}) % ${WAITERS}), IF(n % 3 = 0, CONCAT('perf_ts_', day, '_', n % 2), NULL), closedAt, NOW(3) FROM perf_o`);
  await run(`INSERT INTO OrderTip (id, settlementId, orderId, waiterId, paymentType, amount, createdAt)
    SELECT CONCAT('perf_tip_', n), CONCAT('perf_st_', n), CONCAT('perf_o_', n), CONCAT('perf_u_', FLOOR(n / ${DAYS}) % ${WAITERS}), IF(n % 2 = 0, 'CASH', 'CARD'), 500, closedAt FROM perf_o WHERE n % 5 = 0`);
  // Refunds: 1 in 100, the second line, an hour later.
  await run(`INSERT INTO SaleReturn (id, reference, saleId, customerId, warehouseId, date, status, grandTotal, paid, due, paymentStatus, createdById, createdAt, updatedAt)
    SELECT CONCAT('perf_r_', n), CONCAT('PERFR-', n), CONCAT('perf_s_', n), '${customerId}', '${warehouseId}', DATE(closedAt), 'COMPLETED', s2, s2, 0, 'PAID', 'perf_u_0', DATE_ADD(closedAt, INTERVAL 1 HOUR), NOW(3) FROM perf_o WHERE n % 100 = 7`);
  await run(`INSERT INTO SaleReturnItem (id, returnId, productId, saleItemId, quantity, saleUnit, netUnitPrice, subtotal)
    SELECT CONCAT('perf_ri_', n), CONCAT('perf_r_', n), CONCAT('perf_p_', p2), CONCAT('perf_si_', n, '_2'), q2, 'pc', 1500 + p2 * 250, s2 FROM perf_o WHERE n % 100 = 7`);
  await run(`INSERT INTO SaleReturnPayment (id, saleReturnId, amount, paymentType, date, createdById, tillSessionId, createdAt, updatedAt)
    SELECT CONCAT('perf_rp_', n), CONCAT('perf_r_', n), s2, 'CASH', DATE(closedAt), 'perf_u_0', CONCAT('perf_ts_', day, '_', n % 2), DATE_ADD(closedAt, INTERVAL 1 HOUR), NOW(3) FROM perf_o WHERE n % 100 = 7`);
  await run(`INSERT INTO OrderRefund (id, orderId, saleReturnId, idempotencyKey, returnedToStock, createdById, createdAt)
    SELECT CONCAT('perf_or_', n), CONCAT('perf_o_', n), CONCAT('perf_r_', n), CONCAT('perfr-', n), n % 2, 'perf_u_0', DATE_ADD(closedAt, INTERVAL 1 HOUR) FROM perf_o WHERE n % 100 = 7`);
  // Closed tills keep their figures, counted a little short now and then.
  await run(`UPDATE TillSession ts SET
      cashSales = (SELECT COALESCE(SUM(p.amount), 0) FROM SalePayment p WHERE p.tillSessionId = ts.id),
      cashTips = 0,
      cashRefunds = (SELECT COALESCE(SUM(rp.amount), 0) FROM SaleReturnPayment rp WHERE rp.tillSessionId = ts.id)
    WHERE ts.id LIKE 'perf_ts_%'`);
  await run(`UPDATE TillSession SET expected = \`float\` + cashSales - cashRefunds WHERE id LIKE 'perf_ts_%'`);
  await run(`UPDATE TillSession SET counted = expected - IF(RIGHT(id, 1) = '0', 0, 600), variance = counted - expected WHERE id LIKE 'perf_ts_%'`);
  // A drawer kick for each cash bill (each its own print job).
  await run(`INSERT INTO Printer (id, name, connection, address, updatedAt) VALUES ('perf_printer', 'Perf receipt', 'NETWORK', '10.0.0.252:9100', NOW(3))`);
  await run(`INSERT INTO PrintJob (id, printerId, type, label, template, data, createdAt, updatedAt) SELECT CONCAT('perf_pj_', n), 'perf_printer', 'DRAWER', 'Drawer', 'DRAWER', '{}', closedAt, NOW(3) FROM perf_o WHERE n % 3 = 0`);
  await run(`INSERT INTO DrawerEvent (id, businessId, reason, printerId, printJobId, deviceId, userId, createdAt)
    SELECT CONCAT('perf_de_', n), 'default', IF(n % 30 = 0, 'MANUAL', 'CASH_SALE'), 'perf_printer', CONCAT('perf_pj_', n), CONCAT('perf_dev_', n % 2), CONCAT('perf_u_', FLOOR(n / ${DAYS}) % ${WAITERS}), closedAt FROM perf_o WHERE n % 3 = 0`);
  // Waste: 3,000 entries (1 in 20 voided), each with its stock line.
  await run(`INSERT INTO WasteEntry (id, businessId, warehouseId, productId, qty, unit, reason, costSnapshot, loggedById, status, createdAt, updatedAt)
    SELECT CONCAT('perf_w_', n), 'default', '${warehouseId}', CONCAT('perf_p_', n % ${PRODUCTS - 1}), 1 + n % 3, 'pc', ELT(1 + n % 5, 'BURNT', 'EXPIRED', 'DROPPED', 'RETURNED_BY_GUEST', 'OVERPRODUCTION'),
      (1 + n % 3) * ROUND((1500 + (n % ${PRODUCTS - 1}) * 250) * 0.35, 2), CONCAT('perf_u_', FLOOR(n / ${DAYS}) % ${WAITERS}), IF(n % 20 = 0, 'VOID', 'ACTIVE'),
      DATE_ADD(DATE_ADD('${sqlDate(base)}', INTERVAL n % ${DAYS} DAY), INTERVAL 900 MINUTE), NOW(3)
    FROM perf_n WHERE n < 3000`);
  await run(`INSERT INTO WasteEntryLine (id, entryId, productId, qty, unitCost, lineCost) SELECT CONCAT('perf_wl_', id), id, productId, qty, costSnapshot / qty, costSnapshot FROM WasteEntry WHERE id LIKE 'perf_w_%'`);
  // Shifts: every waiter, every day, 09:00–18:00.
  await run(`INSERT INTO StaffShift (id, userId, startedAt, endedAt, endReason)
    SELECT CONCAT('perf_sh_', d.n, '_', u.n), CONCAT('perf_u_', u.n), DATE_ADD(DATE_ADD('${sqlDate(base)}', INTERVAL d.n DAY), INTERVAL 480 MINUTE), DATE_ADD(DATE_ADD('${sqlDate(base)}', INTERVAL d.n DAY), INTERVAL 1020 MINUTE), 'ENDED'
    FROM perf_n d JOIN perf_n u ON u.n < ${WAITERS} WHERE d.n < ${DAYS}`);
  await run(`DROP TABLE perf_o`);
  await run(`DROP TABLE perf_n`);
  await run(`ANALYZE TABLE \`Order\`, OrderItem, Sale, SaleItem, SalePayment, SaleReturn, SaleReturnItem, OrderTip, WasteEntry, WasteEntryLine, StaffShift, TillSession, DrawerEvent, AuditLog`);
  return { from: addDays(today, -(DAYS - 1)), to: today };
}
