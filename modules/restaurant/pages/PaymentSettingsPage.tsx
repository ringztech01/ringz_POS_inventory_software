import { COLORS, FONTS } from "@/components/layout/theme";
import { RESTAURANT_PERMISSIONS } from "../manifest";
import { guardPage } from "../server/guard";
import { getPaymentSettings } from "../server/services/paymentSettings";
import PaymentSettingsForm from "../components/settings/PaymentSettingsForm";

// /settings/restaurant/payments — Settings › Restaurant › Payments: the
// tablet's tip step. Needs Restaurant Settings; a 404 while the module is off.
export default async function PaymentSettingsPage() {
  const denied = await guardPage(RESTAURANT_PERMISSIONS.RESTAURANT_SETTINGS);
  if (denied) return denied;

  const settings = await getPaymentSettings();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 620 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <h1 style={{ margin: 0, fontFamily: FONTS.display, fontSize: 24, fontWeight: 600, letterSpacing: "-.01em" }}>Payments</h1>
        <p style={{ margin: 0, fontSize: 13.5, color: COLORS.slateMid }}>How bills are paid on the tablets. Discounts on a tablet always need a manager&apos;s PIN; refunds stay on the desktop POS.</p>
      </div>
      <PaymentSettingsForm initial={settings} />
    </div>
  );
}
