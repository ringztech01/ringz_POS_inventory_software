import { restaurantModule } from "@/modules/restaurant/manifest";

// Every optional module. The app shell — the sidebar, lib/permissions.ts, the
// Settings page and the Role form — learns about modules only from here;
// retail code never imports a module directly.
export const MODULES = [restaurantModule] as const;
