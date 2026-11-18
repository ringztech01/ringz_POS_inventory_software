import "server-only";
import { prisma } from "@/lib/db";
import { menuCardSvg, type MenuCard } from "../../lib/menuCard";
import { menuLink } from "../../lib/menuAddress";
import { QR_POINT_TYPE_LABELS } from "../../schemas/menuQr";
import { businessName } from "../businessName";
import { qrSvg } from "../qr";
import { menuSettings } from "../services/menuQr";
import { byFloorOrder } from "./tables";

// Digital menu › QR codes (Part 8 Step 2): every active table (in floor
// order) and QR point, with what the cards print.

export type QrCodeRow = { kind: "table" | "point"; id: string; title: string; subtitle: string; qrToken: string; rotatedAt: Date | null; orderType?: "TAKEAWAY" | "BAR_TAB" };

export type MenuQrPageData = {
  address: string | null;
  wifiName: string | null;
  wifiPassword: string | null;
  // The guest menu's look.
  design: "SHOWCASE" | "CLASSIC";
  // The guest buttons on a table's menu (Step 6).
  callWaiter: boolean;
  requestBill: boolean;
  // Guest ordering (Step 7).
  ordering: { enabled: boolean; requireWaiterConfirm: boolean; autoSend: boolean; maxLines: number; maxValue: string | null; paused: boolean };
  business: string;
  accent: string;
  tables: QrCodeRow[];
  points: QrCodeRow[];
};

export async function getMenuQrPage(): Promise<MenuQrPageData> {
  const [settings, business, tables, points] = await Promise.all([
    menuSettings(),
    businessName(),
    prisma.table.findMany({
      where: { deletedAt: null, area: { deletedAt: null } },
      select: { id: true, name: true, qrToken: true, qrRotatedAt: true, area: { select: { name: true, sortOrder: true, createdAt: true } } },
    }),
    prisma.qrPoint.findMany({ where: { deletedAt: null }, orderBy: [{ name: "asc" }], select: { id: true, name: true, qrToken: true, qrRotatedAt: true, orderType: true } }),
  ]);
  return {
    address: settings.menuBaseUrl,
    wifiName: settings.wifiName,
    wifiPassword: settings.wifiPassword,
    design: settings.menuDesign,
    callWaiter: settings.callWaiterEnabled,
    requestBill: settings.requestBillEnabled,
    ordering: {
      enabled: settings.guestOrderingEnabled,
      requireWaiterConfirm: settings.requireWaiterConfirm,
      autoSend: settings.autoSendGuestOrders,
      maxLines: settings.guestOrderMaxLines,
      maxValue: settings.guestOrderMaxValue?.toFixed(2) ?? null,
      paused: !!settings.guestOrderingPausedAt,
    },
    business,
    accent: settings.accentColour,
    tables: tables.sort(byFloorOrder).map((t) => ({ kind: "table", id: t.id, title: t.name, subtitle: t.area.name, qrToken: t.qrToken, rotatedAt: t.qrRotatedAt })),
    points: points.map((p) => ({
      kind: "point",
      id: p.id,
      title: p.name,
      subtitle: QR_POINT_TYPE_LABELS[p.orderType === "BAR_TAB" ? "BAR_TAB" : "TAKEAWAY"],
      qrToken: p.qrToken,
      rotatedAt: p.qrRotatedAt,
      orderType: p.orderType === "BAR_TAB" ? "BAR_TAB" : "TAKEAWAY",
    })),
  };
}

export type CardSelection = { all: true } | { kind: "table" | "point"; id: string };
export type BuiltCard = { key: string; title: string; svg: string };

// The cards to print or save, made with the saved address. Null: no address
// saved yet (nothing is printed until there is one).
export async function buildMenuCards(selection: CardSelection, as: "print" | "image" = "print"): Promise<BuiltCard[] | null> {
  const page = await getMenuQrPage();
  if (!page.address) return null;
  const rows = [...page.tables, ...page.points].filter((row) => ("all" in selection ? true : row.kind === selection.kind && row.id === selection.id));
  const wifi = page.wifiName ? { name: page.wifiName, password: page.wifiPassword } : null;
  return Promise.all(
    rows.map(async (row) => {
      const link = menuLink(page.address!, row.qrToken);
      const card: MenuCard = {
        business: page.business,
        title: row.kind === "table" ? `Table ${row.title}` : row.title,
        subtitle: row.subtitle,
        qrSvg: await qrSvg(link),
        link,
        wifi,
        accent: page.accent,
      };
      return { key: `${row.kind}-${row.id}`, title: card.title, svg: menuCardSvg(card, as) };
    }),
  );
}
