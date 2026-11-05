import "server-only";
import { cookies } from "next/headers";

// Which device (browser) a request comes from: a long-lived cookie set by
// registerDevice (lib/hardware/deviceActions.ts) the first time a browser
// opens POS, the kitchen display, an order screen or Settings › Printers.
// Clearing the browser's cookies makes it a new device.

export const DEVICE_COOKIE = "ringz_device";
export const DEVICE_ID = /^[0-9a-f-]{36}$/;

export async function currentDeviceId(): Promise<string | null> {
  const value = (await cookies()).get(DEVICE_COOKIE)?.value ?? "";
  return DEVICE_ID.test(value) ? value : null;
}
