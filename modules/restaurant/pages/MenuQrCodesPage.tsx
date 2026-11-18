import { prisma } from "@/lib/db";
import { REPORTS } from "@/lib/hardware/assignments";
import { menuLink } from "../lib/menuAddress";
import { guardMenuQrPage } from "../server/guard";
import { detectedMenuAddresses } from "../server/menuAddress";
import { qrSvg } from "../server/qr";
import { getMenuQrPage, type QrCodeRow } from "../server/queries/menuQr";
import MenuQrCodes, { type QrRowView } from "../components/digitalMenu/MenuQrCodes";

// /restaurant/digital-menu/qr-codes — Digital menu › QR codes (Part 8 Step
// 2). The Administrator or Manage Floor Plan; anyone else is sent home.
export default async function MenuQrCodesPage() {
  await guardMenuQrPage();
  const [page, choices, reportsPrinter] = await Promise.all([
    getMenuQrPage(),
    detectedMenuAddresses(),
    prisma.printerAssignment.findFirst({ where: { role: REPORTS, printer: { deletedAt: null } }, select: { printer: { select: { name: true } } } }),
  ]);
  // Each code as it prints (our own URL → our own SVG: safe to inline).
  const view = async (row: QrCodeRow): Promise<QrRowView> => ({
    kind: row.kind,
    id: row.id,
    title: row.title,
    subtitle: row.subtitle,
    rotatedAt: row.rotatedAt?.toISOString() ?? null,
    thumb: page.address ? await qrSvg(menuLink(page.address, row.qrToken)) : null,
    orderType: row.orderType,
  });
  const [tables, points] = await Promise.all([Promise.all(page.tables.map(view)), Promise.all(page.points.map(view))]);

  return (
    <div style={{ padding: "24px 28px" }}>
      <MenuQrCodes
        address={page.address}
        choices={choices}
        wifiName={page.wifiName ?? ""}
        wifiPassword={page.wifiPassword ?? ""}
        serviceButtons={{ callWaiter: page.callWaiter, requestBill: page.requestBill }}
        ordering={page.ordering}
        tables={tables}
        points={points}
        reportsPrinter={reportsPrinter?.printer.name ?? null}
      />
    </div>
  );
}
