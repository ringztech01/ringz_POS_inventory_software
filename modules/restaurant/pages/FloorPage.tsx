import Link from "next/link";
import { getCurrentUserPermissions } from "@/lib/auth/permissions.server";
import { PERMISSIONS } from "@/lib/permissions";
import { currentDeviceId } from "@/lib/hardware/device";
import { drawerPrinterFor } from "@/lib/hardware/drawer";
import OpenDrawerButton from "@/components/hardware/OpenDrawerButton";
import { COLORS } from "@/components/layout/theme";
import { TABLE_STATUSES } from "../lib/tableStatus";
import { FLOOR_LEGEND } from "../lib/theme";
import { RESTAURANT_PERMISSIONS as P } from "../manifest";
import { guardPageAny } from "../server/guard";
import { noteFloorViewer } from "../server/floorPresence";
import { getFloor } from "../server/queries/floor";
import FloorBoard from "../components/floor/FloorBoard";
import FloorPolling from "../components/floor/FloorPolling";
import NewTakeawayButton from "../components/floor/NewTakeawayButton";
import HeaderActions from "../components/HeaderActions";

// Who can look at the floor. Opening orders, takeaways and Mark clean need
// Manage Orders; seating a booking needs Manage Reservations.
const VIEWERS = [P.MANAGE_ORDERS, P.MANAGE_TABLES, P.MANAGE_RESERVATIONS, P.RESTAURANT_DASHBOARD];

// /restaurant/floor[?area=][&to=pos] — RingzPOS Floor Plan design: area
// tabs, the status legend (all areas), the area's table cards and the side
// panel. Statuses and money come from the server; the board polls every 5s.
// Opened from the touch POS (to=pos), a table's order opens back there.
export default async function FloorPage({ searchParams }: { searchParams: Promise<{ area?: string; to?: string }> }) {
  const denied = await guardPageAny(VIEWERS);
  if (denied) return denied;

  const { permissions, userId } = await getCurrentUserPermissions();
  const canOrders = permissions.has(P.MANAGE_ORDERS);
  const canBook = permissions.has(P.MANAGE_RESERVATIONS);
  const { area, to } = await searchParams;
  // This screen is showing the floor (each 5 s refresh): counted in the
  // editor's "N tablets updated".
  await noteFloorViewer();
  const toPos = to === "pos";
  const floor = await getFloor(area);
  // Open drawer: Open Drawer holders at a till with a cash drawer.
  const drawer = permissions.has(PERMISSIONS.OPEN_DRAWER) ? await drawerPrinterFor(await currentDeviceId()) : null;

  const header = (
    <div style={{ display: "flex", alignItems: "center", gap: 16, rowGap: 10, flexWrap: "wrap" }}>
      {floor.areas.length > 0 && (
        <nav aria-label="Areas" style={{ display: "flex", gap: 4, background: "#fff", border: `1px solid ${COLORS.border}`, borderRadius: 9, padding: 3 }}>
          {floor.areas.map((a) => {
            const on = a.id === floor.areaId;
            return (
              <Link
                key={a.id}
                href={`/restaurant/floor?area=${a.id}${toPos ? "&to=pos" : ""}`}
                replace
                scroll={false}
                aria-current={on ? "page" : undefined}
                style={{
                  height: 32,
                  padding: "0 14px",
                  borderRadius: 6,
                  background: on ? COLORS.teal : "transparent",
                  color: on ? "#fff" : COLORS.slate,
                  fontSize: 13,
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  textDecoration: "none",
                  whiteSpace: "nowrap",
                }}
              >
                {a.name}
                {a.layout && (
                  <span data-area-layout title="Event layout on this floor" style={{ fontSize: 11, fontWeight: 700, color: "#171B1C", background: "#F2B233", padding: "2px 6px", borderRadius: 4 }}>
                    {a.layout}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      )}
      <div aria-label="Legend" style={{ marginLeft: "auto", display: "flex", gap: 16, flexWrap: "wrap" }}>
        {TABLE_STATUSES.map((status) => (
          <span key={status} data-legend={status} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: COLORS.slate, whiteSpace: "nowrap" }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: FLOOR_LEGEND[status] }} />
            {status} · {floor.legend[status]}
          </span>
        ))}
      </div>
    </div>
  );

  const emptyMessage =
    floor.areas.length === 0 ? "No dining areas yet. Add areas and tables on the Tables page." : "No tables in this area yet.";

  return (
    // Flush under the restaurant header and to the edges, as in the design
    // (cancels the dashboard <main>'s padding and gap).
    <div style={{ margin: "-24px -32px 0", display: "grid", gridTemplateColumns: "minmax(0,1fr) 360px", minHeight: "calc(100vh - 120px)" }}>
      <HeaderActions>
        {toPos && (
          <Link
            href="/pos"
            data-back-to-pos
            style={{ height: 36, padding: "0 14px", display: "flex", alignItems: "center", border: `1px solid ${COLORS.borderStrong}`, borderRadius: 8, background: "#fff", color: COLORS.slate, fontSize: 13, fontWeight: 600, textDecoration: "none" }}
          >
            ← Back to POS
          </Link>
        )}
        {drawer && <OpenDrawerButton printer={drawer.name} />}
        <NewTakeawayButton
          areaId={floor.areaId}
          disabledReason={!canOrders ? "Needs the Manage Orders permission." : !floor.areaId ? "Add a dining area first." : null}
          toPos={toPos}
        />
      </HeaderActions>
      <FloorBoard
        header={header}
        tables={floor.tables}
        targets={floor.targets}
        emptyMessage={emptyMessage}
        canOrders={canOrders}
        canBook={canBook}
        requests={floor.requests}
        guestOrders={floor.guestOrders}
        userId={userId ?? null}
        areaId={floor.areaId}
        toPos={toPos}
      />
      <FloorPolling />
    </div>
  );
}
