import { getCurrentUserPermissions } from "@/lib/auth/permissions.server";
import { PERMISSIONS } from "@/lib/permissions";
import { getTicketSettings } from "@/lib/hardware/ticketLook";
import ForbiddenState from "@/components/ui/ForbiddenState";
import TicketTemplatesPanel from "@/components/settings/printers/TicketTemplatesPanel";

// /settings/ticket-templates — the look of every printed ticket (receipts,
// pre-bills, KOTs): logo, header and footer text, kitchen font size, prices
// on KOTs, a QR code — with a preview at 80 mm. Needs Manage Setting.
export default async function TicketTemplatesPage() {
  const { permissions } = await getCurrentUserPermissions();
  if (!permissions.has(PERMISSIONS.MANAGE_SETTING)) return <ForbiddenState permission={PERMISSIONS.MANAGE_SETTING} />;
  const s = await getTicketSettings();
  return (
    <TicketTemplatesPanel
      initial={{
        logo: s.logo,
        header: s.header,
        footer: s.footer,
        kitchenLarge: s.kitchenLarge,
        kotPrices: s.kotPrices,
        qr: s.qr,
        qrText: s.qrText,
      }}
      logoImage={s.logoImage ? { width: s.logoImage.width, height: s.logoImage.height, data: Buffer.from(s.logoImage.data).toString("base64") } : null}
    />
  );
}
