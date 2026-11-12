"use client";

import { useState, useTransition, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Check, LayoutDashboard, MonitorSmartphone } from "lucide-react";
import { COLORS, FONTS } from "@/components/layout/theme";
import type { RestaurantView } from "../../lib/serviceRoutes";
import { setRestaurantInterface } from "../../server/actions/interface";
import type { InterfaceSettings } from "../../server/services/interface";

// Settings › Restaurant › Interface (Part 6f Step 1): the two views as
// preview cards — pick one and save. The next screen load on every device
// uses it (unless the device keeps its own: Settings › Devices).

const VIEWS: { view: RestaurantView; title: string; tag?: string; description: string; flow: string[] }[] = [
  {
    view: "SERVICE",
    title: "Service view",
    tag: "Default",
    description: "Full-screen touch screens for tablets and tills. Staff sign in with their PIN, pick a table on the floor plan and take the order on the Restaurant POS.",
    flow: ["PIN login", "Tables", "Restaurant POS"],
  },
  {
    view: "CLASSIC",
    title: "Classic view",
    description: "The back-office screens, with the sidebar: Restaurant › Floor and the Table order page. The POS button opens the retail counter POS.",
    flow: ["Floor", "Table order", "Retail POS"],
  },
];

export default function InterfaceForm({ initial }: { initial: InterfaceSettings }) {
  const router = useRouter();
  const [saved, setSaved] = useState<RestaurantView>(initial.view);
  const [picked, setPicked] = useState<RestaurantView>(initial.view);
  const [saving, startSaving] = useTransition();
  const label = (view: RestaurantView) => VIEWS.find((v) => v.view === view)!.title;

  function save() {
    startSaving(async () => {
      const result = await setRestaurantInterface({ view: picked }).catch(() => ({ ok: false as const, error: "Couldn't reach the server. Check the connection and try again." }));
      if (!result.ok) return void toast.error(result.error);
      setSaved(picked);
      toast.success(`${label(picked)} saved. Each screen switches the next time it loads.`);
      router.refresh();
    });
  }

  const device = initial.thisDevice;
  const others = initial.overrides.service + initial.overrides.classic - (device?.view ? 1 : 0);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div role="radiogroup" aria-label="Restaurant view" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
        {VIEWS.map(({ view, title, tag, description, flow }) => {
          const on = picked === view;
          return (
            <button
              key={view}
              type="button"
              role="radio"
              aria-checked={on}
              data-interface-card={view}
              onClick={() => setPicked(view)}
              style={{
                textAlign: "left",
                background: "#fff",
                border: `2px solid ${on ? COLORS.teal : COLORS.border}`,
                borderRadius: 12,
                padding: 0,
                cursor: "pointer",
                overflow: "hidden",
                boxShadow: on ? "0 0 0 3px rgba(15,125,106,.12)" : "0 1px 2px rgba(23,27,28,.06)",
                display: "flex",
                flexDirection: "column",
              }}
            >
              {view === "SERVICE" ? <ServicePreview /> : <ClassicPreview />}
              <div style={{ padding: "14px 16px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {view === "SERVICE" ? <MonitorSmartphone size={17} color={COLORS.tealDark} /> : <LayoutDashboard size={17} color={COLORS.tealDark} />}
                  <span style={{ fontFamily: FONTS.display, fontSize: 16, fontWeight: 700, color: COLORS.ink }}>{title}</span>
                  {tag && <span style={{ fontSize: 11, fontWeight: 700, color: COLORS.tealDark, background: COLORS.tealTint, padding: "2px 7px", borderRadius: 999 }}>{tag}</span>}
                  <span
                    aria-hidden
                    style={{ marginLeft: "auto", width: 22, height: 22, borderRadius: "50%", border: `2px solid ${on ? COLORS.teal : COLORS.border}`, background: on ? COLORS.teal : "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}
                  >
                    {on && <Check size={13} strokeWidth={3} color="#fff" />}
                  </span>
                </div>
                <span style={{ fontSize: 13, color: COLORS.slateMid, lineHeight: 1.5 }}>{description}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", fontSize: 12, fontWeight: 600, color: COLORS.slate }}>
                  {flow.map((step, i) => (
                    <span key={step} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      {i > 0 && <span style={{ color: COLORS.slateLight }}>→</span>}
                      <span style={{ background: COLORS.bgApp, borderRadius: 6, padding: "3px 8px" }}>{step}</span>
                    </span>
                  ))}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      <div style={{ background: "#fff", border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: "14px 18px", display: "flex", flexDirection: "column", gap: 6, fontSize: 13, color: COLORS.slateMid, lineHeight: 1.5 }}>
        <span>Switching takes effect the next time a screen loads. Open orders aren&apos;t affected — both views show the same orders.</span>
        <span data-interface-device>
          {device
            ? device.view
              ? `This device (${device.name ?? "unnamed"}) keeps its own view: ${label(device.view)}.`
              : `This device (${device.name ?? "unnamed"}) follows the business.`
            : "This browser hasn't been seen as a device yet; it follows the business."}
          {others > 0 && ` ${others} other device${others === 1 ? " keeps" : "s keep"} their own view.`}{" "}
          <Link href="/settings/devices" style={{ color: COLORS.teal, fontWeight: 600 }}>
            Settings › Devices
          </Link>
        </span>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
        <button
          type="button"
          data-interface-save
          disabled={saving || picked === saved}
          onClick={save}
          style={{ height: 40, padding: "0 18px", border: "none", borderRadius: 8, background: picked === saved ? COLORS.border : COLORS.teal, color: picked === saved ? COLORS.slateMid : "#fff", fontSize: 14, fontWeight: 600, cursor: picked === saved ? "default" : "pointer" }}
        >
          {saving ? "Saving…" : picked === saved ? `${label(saved)} is on` : `Use ${label(picked)}`}
        </button>
      </div>
    </div>
  );
}

// ---- The cards' little screens (not real screenshots: drawn here).
const frame = (dark: boolean): CSSProperties => ({ height: 150, background: dark ? "#1E2228" : "#EEF1F4", display: "flex", gap: 6, padding: 10, borderBottom: `1px solid ${COLORS.border}` });
const block = (bg: string, extra: CSSProperties = {}): CSSProperties => ({ background: bg, borderRadius: 3, ...extra });

function Mini({ children, label, dark }: { children: ReactNode; label: string; dark: boolean }) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
      <div style={{ flex: 1, ...block(dark ? "#15181C" : "#fff"), padding: 5, display: "flex", flexDirection: "column", gap: 4, overflow: "hidden" }}>{children}</div>
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".06em", color: dark ? "#AEB6BE" : COLORS.slateMid, textAlign: "center" }}>{label}</span>
    </div>
  );
}

function ServicePreview() {
  return (
    <div aria-hidden style={frame(true)}>
      <Mini label="PIN" dark>
        <div style={{ display: "flex", gap: 3, justifyContent: "center", marginTop: 6 }}>
          {[0, 1, 2, 3].map((i) => (
            <span key={i} style={{ width: 7, height: 7, borderRadius: "50%", background: i < 2 ? "#3DD68C" : "#3A424C" }} />
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 3, marginTop: 4 }}>
          {Array.from({ length: 9 }, (_, i) => (
            <span key={i} style={block("#2B3139", { height: 12 })} />
          ))}
        </div>
      </Mini>
      <Mini label="TABLES" dark>
        <div style={{ position: "relative", flex: 1 }}>
          {[[4, 6, 18, 18, "50%"], [28, 6, 18, 18, "3px"], [52, 6, 30, 16, "3px"], [6, 34, 22, 14, "3px"], [36, 32, 18, 18, "50%"]].map(([l, t, w, h, r], i) => (
            <span key={i} style={{ position: "absolute", left: `${l}%`, top: t, width: `${w}%`, height: h, borderRadius: r, background: i === 1 ? "#2457A6" : i === 3 ? "#C2611A" : "#2B3139", boxShadow: i === 1 || i === 3 ? "none" : "inset 0 0 0 1.5px #3DD68C" }} />
          ))}
        </div>
      </Mini>
      <Mini label="POS" dark>
        <div style={{ display: "flex", gap: 3, flex: 1 }}>
          <div style={{ flex: 1, ...block("#fff") }} />
          <div style={{ flex: 1.4, display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 3 }}>
            {Array.from({ length: 6 }, (_, i) => (
              <span key={i} style={block(["#B4501A", "#2457A6", "#13804A", "#6B3FA0", "#B4501A", "#2B3139"][i])} />
            ))}
          </div>
        </div>
      </Mini>
    </div>
  );
}

function ClassicPreview() {
  return (
    <div aria-hidden style={frame(false)}>
      <div style={{ width: 26, ...block("#171B1C"), display: "flex", flexDirection: "column", gap: 3, padding: 4 }}>
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i} style={block(i === 2 ? COLORS.teal : "#3A3F46", { height: 5 })} />
        ))}
      </div>
      <Mini label="FLOOR" dark={false}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 3 }}>
          {Array.from({ length: 9 }, (_, i) => (
            <span key={i} style={block(i === 4 ? "#DCE9FA" : i === 7 ? "#FBE7D6" : "#E6F4EF", { height: 22, border: `1px solid ${COLORS.border}` })} />
          ))}
        </div>
      </Mini>
      <Mini label="TABLE ORDER" dark={false}>
        <div style={{ display: "flex", gap: 3, flex: 1 }}>
          <div style={{ flex: 1.3, display: "flex", flexDirection: "column", gap: 3 }}>
            {Array.from({ length: 4 }, (_, i) => (
              <span key={i} style={block(COLORS.bgApp, { height: 10 })} />
            ))}
          </div>
          <div style={{ flex: 1, ...block(COLORS.bgApp), border: `1px solid ${COLORS.border}` }} />
        </div>
      </Mini>
    </div>
  );
}
