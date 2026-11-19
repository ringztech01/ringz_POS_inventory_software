import { redirect } from "next/navigation";
import { RESTAURANT_PERMISSIONS as P } from "../../manifest";
import { guardPage, requireRestaurant } from "../../server/guard";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { pinTerminalId } from "@/lib/auth/pinTerminal";
import { getServiceRoutes } from "../../server/serviceView";
import { isTabletRequest } from "../../server/tabletDevice";
import { signedInLanding } from "../../server/services/pinSignIn";
import TabletPinLogin, { TabletNotPaired } from "../../components/tablet/TabletPinLogin";
import TabletTables from "../../components/tablet/TabletTables";
import TabletOrder from "../../components/tablet/TabletOrder";
import TabletNewOrder from "../../components/tablet/TabletNewOrder";
import { getOrderScreen } from "../../server/queries/orderScreen";
import { getBill } from "../../server/queries/bill";
import { getDiscountApprovers, getVoidApprovers } from "../../server/queries/approvers";
import { getPaymentSettings } from "../../server/services/paymentSettings";
import { getQuickNotes } from "../../server/queries/menuGroups";
import { getCounterOrders, getPosSettings } from "../../server/queries/posScreen";
import { getPosSessionInfo } from "../../server/posSessionInfo";
import { TABLET_TABLES } from "../../lib/tabletDevice";
import { getCurrentUserPermissions } from "@/lib/auth/permissions.server";
import { getFloor } from "../../server/queries/floor";
import { areaFree, barArea, tabletTile } from "../../lib/tabletTables";
import { staffBadge } from "../../lib/posSpeed";
import TabletShell from "../../components/tablet/TabletShell";
import TabletFrame from "../../components/tablet/TabletFrame";
import { T } from "../../components/tablet/tabletTheme";

// The tablet screens' pages (Part 6g): the PIN login (Step 2), Tables
// (Steps 3–4) and an order (Step 5).

function Denied({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: 32, background: "#fff", color: "#171b1c", position: "absolute", inset: 0 }}>{children}</div>;
}

// /t/login — the PIN login (Step 2, portrait). Open to anyone: the tablet
// isn't signed in yet. Signed in already: their home screen. Not a tablet:
// the desktop sign-in. A tablet that isn't a paired PIN terminal can't use a
// PIN at all (Part 6f): it says how to pair it.
export async function TabletLoginPage() {
  await requireRestaurant();
  const [session, terminal, tablet] = await Promise.all([auth(), pinTerminalId(), isTabletRequest()]);
  if (session?.user?.id) {
    const routes = await getServiceRoutes();
    const landing = await signedInLanding(session.user.id, terminal, routes).catch(() => null);
    redirect(landing ?? routes.tables());
  }
  if (!tablet) redirect("/");
  if (!terminal) {
    return (
      <TabletShell orientation="portrait" signedIn={false} offlineBar={false}>
        <TabletNotPaired />
      </TabletShell>
    );
  }
  const [device, settings] = await Promise.all([prisma.device.findUnique({ where: { id: terminal }, select: { name: true, terminalRole: true, homeArea: { select: { name: true } } } }), getPosSettings()]);
  return (
    <TabletShell orientation="portrait" signedIn={false} offlineBar={false} wakeLock={settings.tabletWakeLock}>
      <TabletPinLogin deviceName={device?.name?.trim() || "This tablet"} areaName={device?.homeArea?.name ?? null} kind={device?.terminalRole ?? "POS"} />
    </TabletShell>
  );
}

// /t/tables[?area=][&focus=bar] — Tables: the tile grid upright (Step 3),
// the floor drawn from the floor plan in landscape (Step 4). Manage Orders. The floor is the desktop
// POS's own (getFloor); a Bartender with no area of their own opens on the
// bar's.
export async function TabletTablesPage({ searchParams }: { searchParams: Promise<{ area?: string; focus?: string }> }) {
  const denied = await guardPage(P.MANAGE_ORDERS);
  if (denied) return <Denied>{denied}</Denied>;
  const { area, focus } = await searchParams;
  let floor = await getFloor(typeof area === "string" ? area : undefined);
  if (!area && focus === "bar") {
    const bar = barArea(floor.areas);
    if (bar && bar !== floor.areaId) floor = await getFloor(bar);
  }
  const current = await getCurrentUserPermissions();
  // Every area is drawn in landscape: one never saved in the editor gets its
  // tables in a grid by number (6g follow-up 3), and a manager who may edit
  // the floor plan gets a link to arrange it there. Waiters never see it.
  const canArrange = !current.serviceOnly && current.permissions.has(P.MANAGE_FLOOR_PLAN);
  const settings = await getPosSettings();
  const [user, session, counter] = await Promise.all([
    current.userId ? prisma.user.findUnique({ where: { id: current.userId }, select: { firstName: true, lastName: true, displayName: true } }) : null,
    getPosSessionInfo(current, settings),
    // The open takeaways and tabs (6g follow-up 2), as the desktop's strip.
    getCounterOrders(),
  ]);
  const name = user ? user.displayName?.trim() || `${user.firstName} ${user.lastName}`.trim() : "";
  return (
    <TabletShell orientation="any" wakeLock={settings.tabletWakeLock}>
      <TabletTables
        user={{ id: current.userId ?? "", firstName: user?.displayName?.trim() || user?.firstName || "", initials: staffBadge(name).initials, manager: !current.serviceOnly }}
        areas={floor.areas.map((a) => ({ id: a.id, name: a.name, free: areaFree(a) }))}
        areaId={floor.areaId}
        tiles={floor.tables.map((t) => tabletTile(t, current.userId ?? ""))}
        can={{ book: current.permissions.has(P.MANAGE_RESERVATIONS), settle: current.permissions.has(P.SETTLE_BILL) }}
        session={session.shift}
        autoLockSeconds={session.terminal ? session.lockSeconds : 0}
        areaName={floor.areas.find((a) => a.id === floor.areaId)?.name ?? ""}
        room={floor.room}
        planSaved={floor.planSaved}
        canArrange={canArrange}
        fixtures={floor.fixtures.map((f) => ({ id: f.id, x: f.x, y: f.y, w: f.w, h: f.h, rotation: f.rotation, label: f.label }))}
        places={Object.fromEntries(floor.tables.map((t) => [t.id, t.place]))}
        summary={{ free: floor.summary.free, openOrders: floor.summary.openOrders, openValue: floor.summary.openValue }}
        requests={floor.requests}
        counter={counter}
      />
    </TabletShell>
  );
}

// /t/order/[orderId][?pay=1] — an order (Step 5, portrait). Manage Orders.
// The same data the desktop POS loads for it (getOrderScreen, the bill,
// who can approve a void); the item columns (Settings › Restaurant › Touch
// POS) and whether SEND goes back to Tables.
export async function TabletOrderPage({ params, searchParams }: { params: Promise<{ orderId: string }>; searchParams: Promise<{ pay?: string }> }) {
  const denied = await guardPage(P.MANAGE_ORDERS);
  if (denied) return <Denied>{denied}</Denied>;
  const [{ orderId }, { pay }] = await Promise.all([params, searchParams]);
  const [data, bill, voidApprovers, discountApprovers, payments, quickNotes, settings, current] = await Promise.all([getOrderScreen(orderId), getBill(orderId), getVoidApprovers(), getDiscountApprovers(), getPaymentSettings(), getQuickNotes(), getPosSettings(), getCurrentUserPermissions()]);
  if (!data || !bill) {
    return (
      <TabletShell orientation="portrait">
        <TabletFrame title="Order" right={<a href={TABLET_TABLES} className="tb-press" style={{ height: 64, padding: "0 20px", display: "flex", alignItems: "center", borderRadius: 8, background: "#1F2226", color: T.text, fontSize: 20, fontWeight: 900, textDecoration: "none" }}>‹ TABLES</a>}>
          <div data-order-missing style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: 40, textAlign: "center", fontSize: 26, fontWeight: 900 }}>
            This order isn&apos;t here any more.
          </div>
        </TabletFrame>
      </TabletShell>
    );
  }
  const session = await getPosSessionInfo(current, settings);
  return (
    <TabletShell orientation="portrait" wakeLock={settings.tabletWakeLock}>
      <TabletOrder
        data={data}
        bill={bill}
        voidApprovers={voidApprovers}
        discountApprovers={discountApprovers}
        tipsOn={payments.tabletTips}
        quickNotes={quickNotes}
        columns={settings.tabletColumns}
        sendToFloor={settings.sendToFloor}
        canSettle={current.permissions.has(P.SETTLE_BILL)}
        canWaste={current.permissions.has(P.LOG_WASTE)}
        openPay={pay === "1"}
        autoLockSeconds={session.terminal ? session.lockSeconds : 0}
      />
    </TabletShell>
  );
}

// /t/order/new?type=TAKEAWAY|BAR_TAB[&name=…] — a new takeaway or bar tab
// (Step 5, portrait): opened once, then its Order screen. Manage Orders.
export async function TabletNewOrderPage({ searchParams }: { searchParams: Promise<{ type?: string; name?: string }> }) {
  const denied = await guardPage(P.MANAGE_ORDERS);
  if (denied) return <Denied>{denied}</Denied>;
  const { type, name } = await searchParams;
  const tabName = typeof name === "string" ? name.trim() : "";
  if (type !== "TAKEAWAY" && !(type === "BAR_TAB" && tabName)) redirect(TABLET_TABLES);
  return (
    <TabletShell orientation="portrait">
      <TabletNewOrder type={type} name={tabName} />
    </TabletShell>
  );
}
