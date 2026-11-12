"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { DEFAULT_VIEW, routesFor, type RestaurantView, type ServiceRoutes } from "../lib/serviceRoutes";

// This screen's restaurant view for client components (Part 6f Step 1),
// set by the dashboard and POS layouts from the server's resolver.
const ViewContext = createContext<RestaurantView>(DEFAULT_VIEW);

export function ServiceViewProvider({ view, children }: { view: RestaurantView; children: ReactNode }) {
  return <ViewContext.Provider value={view}>{children}</ViewContext.Provider>;
}

export function useServiceRoutes(): ServiceRoutes {
  const view = useContext(ViewContext);
  return useMemo(() => routesFor(view), [view]);
}
