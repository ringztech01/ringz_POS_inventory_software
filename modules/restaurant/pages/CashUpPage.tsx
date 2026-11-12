import { currentDeviceId } from "@/lib/hardware/device";
import { RESTAURANT_PERMISSIONS } from "../manifest";
import { guardPage } from "../server/guard";
import { getServiceRoutes } from "../server/serviceView";
import { getTillScreen } from "../server/services/till";
import CashUpScreen from "../components/pos/CashUpScreen";

// /pos/cash-up — this till's cash-up (Part 6f Step 7b): open it with a
// float, close it with the cash counted (expected vs counted, the variance),
// the Z-report on screen and through the print queue; its last five. Settle
// Bill; a 404 while the module is off.
export default async function CashUpPage() {
  const denied = await guardPage(RESTAURANT_PERMISSIONS.SETTLE_BILL);
  if (denied) return <div style={{ padding: 32 }}>{denied}</div>;
  const [deviceId, routes] = await Promise.all([currentDeviceId(), getServiceRoutes()]);
  const back = routes.tables();
  if (!deviceId) return <CashUpScreen screen={null} back={back} />;
  return <CashUpScreen screen={await getTillScreen(deviceId)} back={back} />;
}
