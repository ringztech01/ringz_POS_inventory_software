"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { useScan } from "@/components/hardware/ScanProvider";
import { TOUCH } from "../../lib/theme";
import type { Approver } from "../../server/queries/approvers";
import type { BillView } from "../../server/queries/bill";
import type { OrderScreenData } from "../../server/queries/orderScreen";
import type { RefundView } from "../../server/queries/refund";
import type { PosSettings, PosStaff } from "../../server/queries/posScreen";
import CheckPanel from "./CheckPanel";
import FunctionBar, { type FnKey } from "./FunctionBar";
import MenuPad from "./MenuPad";
import MoreMenu from "./MoreMenu";
import OrderPos from "./OrderPos";
import PosSession, { usePosSession } from "./PosSession";
import { useServiceRoutes } from "../ServiceRoutes";
import PosFrame from "./PosFrame";
import PosHeader from "./PosHeader";
import type { PosSessionInfo } from "../../server/posSessionInfo";
import TouchButton from "./TouchButton";

export type LoadedOrder = {
  data: OrderScreenData;
  voidApprovers: Approver[];
  bill: BillView;
  approvers: Approver[];
  waste: { approvers: Approver[] } | null;
  printers: { prebill: string | null; receipt: string | null };
  canSettle: boolean;
  refundView: RefundView | null;
};

const hiddenKey = (label: string): FnKey => ({ label, hidden: true });

// backOffice: a Back office key (Part 6f Step 5) — not for a Service-level role.
export type PosCan = { kitchen: boolean; sales: boolean; dashboard: boolean; backOffice: boolean };

// No order loaded: the menu can be browsed, and Tables opens one.
function NoOrder({ menu, userName, missing, can }: { menu: OrderScreenData["menu"]; userName: string; missing: boolean; can: PosCan }) {
  const router = useRouter();
  const session = usePosSession();
  const [more, setMore] = useState(false);
  const routes = useServiceRoutes();
  useEffect(() => {
    router.prefetch(routes.tables());
  }, [router, routes]);
  const tables = () => session.goTables();
  // F1: Tables (as on an order); a scan needs a table first.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "F1") return;
      event.preventDefault();
      if (!document.querySelector('[role="dialog"]')) router.push(routes.tables());
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [router, routes]);
  useScan(() => void toast("Open a table first — tap Tables."));

  return (
    <PosFrame
      header={<PosHeader saving={false} facts={{ title: "No table open", detail: userName, orderRef: null, closed: null }} />}
      check={
        <CheckPanel
          lines={[]}
          pending={[]}
          totals={null}
          busy={false}
          highlightKey={null}
          selectedId={null}
          onSelect={() => undefined}
          empty={
            <div style={{ display: "flex", flexDirection: "column", gap: 14, alignItems: "stretch" }}>
              <span data-no-order>{missing ? "That order isn't open any more. Pick a table." : "Pick a table — or start a Takeaway or a Bar tab up top."}</span>
              <TouchButton background={TOUCH.teal} onClick={tables} style={{ height: 56, fontFamily: TOUCH.display, fontSize: 18, fontWeight: 700 }}>
                Open a table
              </TouchButton>
            </div>
          }
        />
      }
      menu={<MenuPad menu={menu} locked onPick={() => void toast("Open a table first — tap Tables.")} />}
      functions={
        <FunctionBar
          left={[
            { label: "Tables", onClick: tables },
            hiddenKey("Seat"),
            hiddenKey("Qty"),
            hiddenKey("Note"),
            hiddenKey("Hold"),
            hiddenKey("Void"),
            {
              label: "More…",
              onClick: () => setMore((shown) => !shown),
              popover: more ? (
                <MoreMenu
                  onClose={() => setMore(false)}
                  items={[
                    { label: "Open drawer", onClick: () => session.openDrawer?.(), hidden: !session.openDrawer },
                    { label: "Kitchen display", onClick: () => router.push("/restaurant/kitchen"), hidden: !can.kitchen },
                    { label: "Back office", onClick: session.exit, hidden: !session.leaveHref },
                  ]}
                />
              ) : null,
            },
          ]}
          right={[hiddenKey("Print bill"), hiddenKey("Split"), hiddenKey("Send"), hiddenKey("Pay")]}
        />
      }
    />
  );
}

// /pos in Restaurant mode (Part 6e): the fixed touch layout, with the order
// from ?order= or none yet. Keyed by the order so switching tables starts
// the screen afresh.
export default function RestaurantPos({
  order,
  openPay = false,
  menu,
  user,
  missing,
  settings,
  session,
  quickNotes,
  staff,
  can,
  drawer,
}: {
  order: LoadedOrder | null;
  // Pay from the tables screen: the order opens with its payment up.
  openPay?: boolean;
  menu: OrderScreenData["menu"];
  user: { id: string; name: string };
  missing: boolean;
  settings: PosSettings;
  quickNotes: string[];
  staff: { staff: PosStaff[]; withoutPin: number };
  session: PosSessionInfo;
  // What this user may open (hidden otherwise), and this till's drawer.
  can: PosCan;
  drawer: { approvers: Approver[] } | null;
}) {
  return (
    <PosSession user={user} staff={staff.staff} withoutPin={staff.withoutPin} lockSeconds={session.lockSeconds} terminal={session.terminal} shift={session.shift} training={session.training} drawer={drawer} leaveHref={can.backOffice ? (can.dashboard ? "/restaurant" : "/dashboard") : null} lightTheme={settings.lightTheme}>
      {order ? (
        <OrderPos key={order.data.order.id} {...order} openPay={openPay} can={can} returnHome={settings.returnHome} sendToFloor={settings.sendToFloor} quickNotes={quickNotes} />
      ) : (
        <NoOrder menu={menu} userName={user.name} missing={missing} can={can} />
      )}
    </PosSession>
  );
}
