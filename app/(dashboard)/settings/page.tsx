import { getCurrentUserPermissions } from "@/lib/auth/permissions.server";
import { getBusinessSettings } from "@/lib/business-settings";
import { MODULES } from "@/lib/modules/registry";
import { PERMISSIONS } from "@/lib/permissions";
import { COLORS, FONTS } from "@/components/layout/theme";
import ForbiddenState from "@/components/ui/ForbiddenState";
import Link from "next/link";
import { ChevronRight, Printer } from "lucide-react";
import ModuleSwitch from "@/components/settings/ModuleSwitch";

// /settings — business settings: the optional modules' switches
// (lib/modules/registry.ts) and, with Manage Setting, Printers. Opens with Manage Setting or any
// module's settings permission; each switch needs its own permission.
export default async function SettingsPage() {
  const { permissions } = await getCurrentUserPermissions();
  const canOpen =
    permissions.has(PERMISSIONS.MANAGE_SETTING) || MODULES.some((mod) => permissions.has(mod.toggle.permission));
  if (!canOpen) return <ForbiddenState permission={PERMISSIONS.MANAGE_SETTING} />;

  const settings = await getBusinessSettings();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <h1 style={{ margin: 0, fontFamily: FONTS.display, fontSize: 26, fontWeight: 700, letterSpacing: "-.015em" }}>
          Settings
        </h1>
        <p style={{ margin: 0, fontSize: 13.5, color: COLORS.slateMid }}>Settings for the whole business.</p>
      </div>

      <section
        aria-label="Modules"
        style={{
          background: "#fff",
          border: `1px solid ${COLORS.border}`,
          borderRadius: 12,
          boxShadow: "0 1px 2px rgba(23,27,28,.06)",
        }}
      >
        <div style={{ padding: "18px 24px", borderBottom: `1px solid ${COLORS.border}` }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Modules</h2>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: COLORS.slateMid }}>
            Optional features. While a module is off, its pages, menu entries and permissions are hidden.
          </p>
        </div>
        {MODULES.map((mod) => {
          const Icon = mod.icon;
          const canChange = permissions.has(mod.toggle.permission);
          return (
            <div key={mod.id} style={{ display: "flex", alignItems: "center", gap: 16, padding: "18px 24px" }}>
              <span
                style={{
                  width: 40,
                  height: 40,
                  flex: "0 0 auto",
                  borderRadius: 10,
                  background: COLORS.tealTint,
                  color: COLORS.tealDark,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Icon size={19} strokeWidth={1.6} />
              </span>
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: COLORS.ink }}>{mod.label}</span>
                <span style={{ fontSize: 13, color: COLORS.slateMid }}>{mod.description}</span>
                {!canChange && (
                  <span style={{ fontSize: 12.5, color: COLORS.slateLight }}>
                    Needs the &ldquo;{mod.toggle.permission}&rdquo; permission to change.
                  </span>
                )}
              </div>
              <ModuleSwitch
                moduleId={mod.id}
                label={mod.label}
                enabled={mod.isEnabled(settings)}
                canChange={canChange}
              />
            </div>
          );
        })}
      </section>

      {permissions.has(PERMISSIONS.MANAGE_SETTING) && (
        <section aria-label="Hardware" style={{ background: "#fff", border: `1px solid ${COLORS.border}`, borderRadius: 12, boxShadow: "0 1px 2px rgba(23,27,28,.06)" }}>
          <div style={{ padding: "18px 24px", borderBottom: `1px solid ${COLORS.border}` }}>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Hardware</h2>
          </div>
          <Link href="/settings/printers" style={{ display: "flex", alignItems: "center", gap: 16, padding: "18px 24px", color: COLORS.ink, textDecoration: "none" }}>
            <span style={{ width: 40, height: 40, flex: "0 0 auto", borderRadius: 10, background: COLORS.tealTint, color: COLORS.tealDark, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Printer size={19} strokeWidth={1.6} />
            </span>
            <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>Printers</span>
              <span style={{ fontSize: 13, color: COLORS.slateMid }}>Receipt, kitchen and report printers, which one does each job, and per-device printers.</span>
            </span>
            <ChevronRight size={16} strokeWidth={1.8} color={COLORS.slateMid} />
          </Link>
        </section>
      )}
    </div>
  );
}
