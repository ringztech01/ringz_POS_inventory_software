"use client";

import { useState, useTransition, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { MonitorSmartphone } from "lucide-react";
import { COLORS, FONTS } from "@/components/layout/theme";
import { renameDevice } from "@/app/(dashboard)/settings/devices/actions";
import { setDeviceInterface } from "@/modules/restaurant/server/actions/interface";
import { setPinTerminal } from "@/modules/restaurant/server/actions/pinSignIn";

type View = "SERVICE" | "CLASSIC";
// terminal (Part 6f Steps 4 and 7c): not paired (null), a PIN terminal, the
// Kitchen screen or a Bar terminal (on `areaId`).
type Kind = "POS" | "KITCHEN" | "BAR";
export type DeviceListRow = { id: string; name: string | null; browser: string; lastSeen: string; view: View | null; terminal: Kind | null; areaId: string | null };
type Restaurant = { businessView: View; canPair: boolean; areas: { id: string; name: string }[] };
const KIND_LABEL: Record<Kind, string> = { POS: "PIN terminal", KITCHEN: "Kitchen screen", BAR: "Bar terminal" };
const KIND_DONE: Record<Kind, string> = {
  POS: "a PIN terminal — it opens on the PIN screen.",
  KITCHEN: "the Kitchen screen — the PIN screen, for Kitchen staff and managers, then the kitchen display.",
  BAR: "a Bar terminal — the PIN screen, then Tables on its area.",
};

const VIEW_LABEL: Record<View, string> = { SERVICE: "Service view", CLASSIC: "Classic view" };
const UNREACHABLE = "Couldn't reach the server. Check the connection and try again.";

// Settings › Devices: each device's name, browser and last seen; with the
// Restaurant module on, its view — the business's, or its own (Part 6f).
export default function DevicesPanel({ devices, thisDeviceId, restaurant }: { devices: DeviceListRow[]; thisDeviceId: string | null; restaurant: Restaurant | null }) {
  const cell: CSSProperties = { padding: "12px 16px", borderTop: `1px solid ${COLORS.border}`, fontSize: 13.5, verticalAlign: "middle" };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <h1 style={{ margin: 0, fontFamily: FONTS.display, fontSize: 24, fontWeight: 600, letterSpacing: "-.01em" }}>Devices</h1>
        <p style={{ margin: 0, fontSize: 13.5, color: COLORS.slateMid, maxWidth: 720, lineHeight: 1.5 }}>
          Every browser that has opened the POS, the kitchen display, an order or Settings. Clearing a browser&apos;s cookies makes it a new device.
          {restaurant && (
            <>
              {" "}
              A device can keep its own restaurant view — say, a bar PC on Classic while the tablets use{" "}
              <Link href="/settings/restaurant/interface" style={{ color: COLORS.teal, fontWeight: 600 }}>
                the business&apos;s view
              </Link>{" "}
              ({VIEW_LABEL[restaurant.businessView]}). A paired device always opens on the PIN screen — no email or password sign-in on it at all: a <strong>PIN terminal</strong>; the <strong>Kitchen screen</strong> (Kitchen staff and managers, then the kitchen display); a <strong>Bar terminal</strong> (Tables on its area){restaurant.canPair ? "" : ". Only an Administrator pairs one"}.
            </>
          )}
        </p>
      </div>
      <section style={{ background: "#fff", border: `1px solid ${COLORS.border}`, borderRadius: 12, overflow: "hidden" }}>
        {devices.length === 0 ? (
          <p style={{ margin: 0, padding: 24, fontSize: 14, color: COLORS.slateMid }}>No devices yet. A browser shows up here the first time it opens the POS or Settings.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", fontSize: 12, color: COLORS.slateMid, textTransform: "uppercase", letterSpacing: ".04em" }}>
                <th style={{ padding: "10px 16px", fontWeight: 600 }}>Name</th>
                <th style={{ padding: "10px 16px", fontWeight: 600 }}>Browser</th>
                <th style={{ padding: "10px 16px", fontWeight: 600 }}>Last seen</th>
                {restaurant && <th style={{ padding: "10px 16px", fontWeight: 600 }}>Restaurant view</th>}
                {restaurant && <th style={{ padding: "10px 16px", fontWeight: 600 }}>Paired as</th>}
              </tr>
            </thead>
            <tbody>
              {devices.map((device) => (
                <DeviceRow key={device.id} device={device} isThis={device.id === thisDeviceId} restaurant={restaurant} cell={cell} />
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function DeviceRow({ device, isThis, restaurant, cell }: { device: DeviceListRow; isThis: boolean; restaurant: Restaurant | null; cell: CSSProperties }) {
  const router = useRouter();
  const [name, setName] = useState(device.name ?? "");
  const [working, startWork] = useTransition();
  function saveName() {
    if (name.trim() === (device.name ?? "")) return;
    startWork(async () => {
      const result = await renameDevice({ id: device.id, name }).catch(() => ({ ok: false as const, error: UNREACHABLE }));
      if (!result.ok) return void toast.error(result.error);
      toast.success("Device renamed.");
      router.refresh();
    });
  }
  // The Bartender's area, else one called "Bar…", for a new Bar terminal.
  const barArea = restaurant?.areas.find((a) => /bar/i.test(a.name))?.id ?? restaurant?.areas[0]?.id ?? null;
  function savePin(kind: Kind | null, areaId: string | null = device.areaId) {
    if (kind && !device.terminal && isThis && !window.confirm(`Make this device ${kind === "POS" ? "a PIN terminal" : kind === "KITCHEN" ? "the Kitchen screen" : "a Bar terminal"}? Once you sign out, it only opens on the PIN screen — there's no email sign-in on it any more. Sign in with your PIN, or unpair it from another device.`))
      return;
    startWork(async () => {
      const result = await setPinTerminal({ deviceId: device.id, on: !!kind, kind: kind ?? undefined, areaId: kind === "BAR" ? (areaId ?? barArea) : null }).catch(() => ({ ok: false as const, error: UNREACHABLE }));
      if (!result.ok) return void toast.error(result.error);
      toast.success(`${name.trim() || "This device"}: ${kind ? KIND_DONE[kind] : "not paired — the email sign-in is back."}`);
      router.refresh();
    });
  }
  function saveView(value: string) {
    const view: View | null = value === "SERVICE" || value === "CLASSIC" ? value : null;
    startWork(async () => {
      const result = await setDeviceInterface({ deviceId: device.id, view }).catch(() => ({ ok: false as const, error: UNREACHABLE }));
      if (!result.ok) return void toast.error(result.error);
      toast.success(`${name.trim() || "This device"}: ${view ? VIEW_LABEL[view] : "follows the business"}. It switches the next time a screen loads.`);
      router.refresh();
    });
  }
  return (
    <tr data-device-row={device.id}>
      <td style={cell}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <MonitorSmartphone size={17} color={COLORS.slateMid} />
          <input
            aria-label="Device name"
            data-device-name
            value={name}
            maxLength={80}
            placeholder="e.g. Bar PC"
            disabled={working}
            onChange={(event) => setName(event.target.value)}
            onBlur={saveName}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
            style={{ height: 34, minWidth: 200, border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: "0 10px", fontSize: 13.5 }}
          />
          {isThis && (
            <span data-this-device style={{ fontSize: 11, fontWeight: 700, color: COLORS.tealDark, background: COLORS.tealTint, padding: "2px 8px", borderRadius: 999, whiteSpace: "nowrap" }}>
              This device
            </span>
          )}
        </div>
      </td>
      <td style={{ ...cell, color: COLORS.slateMid }}>{device.browser}</td>
      <td style={{ ...cell, color: COLORS.slateMid, whiteSpace: "nowrap" }}>{device.lastSeen}</td>
      {restaurant && (
        <td style={cell}>
          <select
            aria-label="Restaurant view"
            data-device-view
            value={device.view ?? ""}
            disabled={working}
            onChange={(event) => saveView(event.target.value)}
            style={{ height: 34, border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: "0 8px", fontSize: 13.5, background: "#fff" }}
          >
            <option value="">Business default ({VIEW_LABEL[restaurant.businessView]})</option>
            <option value="SERVICE">Service view</option>
            <option value="CLASSIC">Classic view</option>
          </select>
        </td>
      )}
      {restaurant && (
        <td style={cell}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <select
              aria-label="Paired as"
              data-device-pin
              value={device.terminal ?? ""}
              disabled={working || !restaurant.canPair}
              onChange={(event) => savePin((event.target.value || null) as Kind | null)}
              style={{ height: 34, border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: "0 8px", fontSize: 13.5, background: "#fff" }}
            >
              <option value="">Not paired</option>
              {(["POS", "KITCHEN", "BAR"] as const).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
            {device.terminal === "BAR" && (
              <select
                aria-label="Bar terminal's area"
                data-device-area
                value={device.areaId ?? ""}
                disabled={working || !restaurant.canPair}
                onChange={(event) => savePin("BAR", event.target.value || null)}
                style={{ height: 34, border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: "0 8px", fontSize: 13.5, background: "#fff" }}
              >
                <option value="">The Bartender&apos;s area</option>
                {restaurant.areas.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        </td>
      )}
    </tr>
  );
}
