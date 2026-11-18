import { z } from "zod";
import { idSchema } from "./common";

// Digital menu › QR codes (Part 8 Step 2): what the page's actions accept.

export const QR_POINT_NAME_MAX = 40;
export const WIFI_MAX = 64;

export const menuAddressSchema = z.object({ address: z.string().max(300) });

// The guest menu's look: Showcase (the default) or Classic.
export const MENU_DESIGNS = ["SHOWCASE", "CLASSIC"] as const;
export type MenuDesignChoice = (typeof MENU_DESIGNS)[number];
export const menuDesignSchema = z.object({ design: z.enum(MENU_DESIGNS) });

export const menuWifiSchema = z.object({
  name: z.string().trim().max(WIFI_MAX, `At most ${WIFI_MAX} characters.`),
  password: z.string().max(WIFI_MAX, `At most ${WIFI_MAX} characters.`),
});

// Which code: a table's or a QR point's.
export const qrTargetSchema = z.object({ kind: z.enum(["table", "point"]), id: idSchema });

const pointName = z.string().trim().min(1, "Give the point a name.").max(QR_POINT_NAME_MAX, `At most ${QR_POINT_NAME_MAX} characters.`);

// A point is a takeaway counter (no table) or the bar (opens on the Bar tab).
export const QR_POINT_TYPES = ["TAKEAWAY", "BAR_TAB"] as const;
export const QR_POINT_TYPE_LABELS: Record<(typeof QR_POINT_TYPES)[number], string> = { TAKEAWAY: "Takeaway", BAR_TAB: "Bar" };

export const newQrPointSchema = z.object({ name: pointName, orderType: z.enum(QR_POINT_TYPES) });
export const renameQrPointSchema = z.object({ id: idSchema, name: pointName });
