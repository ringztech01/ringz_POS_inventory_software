import { getCurrentUserPermissions, isSystemAdmin } from "@/lib/auth/permissions.server";
import { getBusinessSettings } from "@/lib/business-settings";
import { MODULES } from "@/lib/modules/registry";
import { PERMISSIONS } from "@/lib/permissions";
import { COLORS, FONTS } from "@/components/layout/theme";
import ForbiddenState from "@/components/ui/ForbiddenState";
import Link from "next/link";
import { ChevronRight, MonitorSmartphone, Printer, ScanLine, ShieldCheck, Users, UtensilsCrossed, ScrollText, Wallet } from "lucide-react";
import { prisma } from "@/lib/db";
import { BUSINESS_SETTINGS_ID } from "@/lib/business-settings";
import { isModuleEnabled } from "@/lib/modules/enabled.server";
import { restaurantModule } from "@/modules/restaurant/manifest";
import ModuleSwitch from "@/components/settings/ModuleSwitch";

// /settings — business settings: the optional modules' switches
// (lib/modules/registry.ts) and, with Manage Setting, Printers. Opens with Manage Setting or any
// module's settings permission; each switch needs its own permission.
export default async function SettingsPage() {
  const current = await getCurrentUserPermissions();
  const { permissions } = current;
  const canOpen =
    permissions.has(PERMISSIONS.MANAGE_SETTING) || MODULES.some((mod) => permissions.has(mod.toggle.permission));
  if (!canOpen) return <ForbiddenState permission={PERMISSIONS.MANAGE_SETTING} />;

  const settings = await getBusinessSettings();
  const restaurantOn = await isModuleEnabled(restaurantModule.id);
  // Part 6f: staff roles — the Administrator's alone.
  const canRoles = restaurantOn && (await isSystemAdmin(current));
  // Part 6f Step 7e: the audit log (View Audit Log).
  const canAudit = restaurantOn && permissions.has(PERMISSIONS.VIEW_AUDIT_LOG);
  // The tablet's payments (the tip step): Restaurant Settings.
  const canPayments = restaurantOn && permissions.has(restaurantModule.toggle.permission);
  // Part 6f: the restaurant's view, shown under Restaurant › Interface.
  const restaurantView = permissions.has(PERMISSIONS.MANAGE_SETTING) && restaurantOn
    ? ((await prisma.businessSetting.findUnique({ where: { id: BUSINESS_SETTINGS_ID }, select: { restaurantInterface: true } }))?.restaurantInterface ?? "SERVICE")
    : null;

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

      {(restaurantView || canRoles || canAudit || canPayments) && (
        <section aria-label="Restaurant" style={{ background: "#fff", border: `1px solid ${COLORS.border}`, borderRadius: 12, boxShadow: "0 1px 2px rgba(23,27,28,.06)" }}>
          <div style={{ padding: "18px 24px", borderBottom: `1px solid ${COLORS.border}` }}>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Restaurant</h2>
          </div>
          {restaurantView && (
          <Link href="/settings/restaurant/interface" data-settings-interface style={{ display: "flex", alignItems: "center", gap: 16, padding: "18px 24px", color: COLORS.ink, textDecoration: "none" }}>
            <span style={{ width: 40, height: 40, flex: "0 0 auto", borderRadius: 10, background: COLORS.tealTint, color: COLORS.tealDark, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <UtensilsCrossed size={19} strokeWidth={1.6} />
            </span>
            <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>Interface</span>
              <span style={{ fontSize: 13, color: COLORS.slateMid }}>
                {restaurantView === "SERVICE" ? "Service view: PIN login, the touch Tables screen and the Restaurant POS." : "Classic view: Restaurant › Floor, the Table order page and the retail POS."}
              </span>
            </span>
            <ChevronRight size={16} strokeWidth={1.8} color={COLORS.slateMid} />
          </Link>
          )}
          {canRoles && (
            <Link href="/settings/restaurant/staff" data-settings-staff style={{ display: "flex", alignItems: "center", gap: 16, padding: "18px 24px", color: COLORS.ink, textDecoration: "none", borderTop: restaurantView ? `1px solid ${COLORS.border}` : undefined }}>
              <span style={{ width: 40, height: 40, flex: "0 0 auto", borderRadius: 10, background: COLORS.tealTint, color: COLORS.tealDark, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Users size={19} strokeWidth={1.6} />
              </span>
              <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>Staff</span>
                <span style={{ fontSize: 13, color: COLORS.slateMid }}>Add staff, set and reset their PINs, disable people who leave. Administrator only.</span>
              </span>
              <ChevronRight size={16} strokeWidth={1.8} color={COLORS.slateMid} />
            </Link>
          )}
          {canRoles && (
            <Link href="/settings/restaurant/roles" data-settings-roles style={{ display: "flex", alignItems: "center", gap: 16, padding: "18px 24px", color: COLORS.ink, textDecoration: "none", borderTop: `1px solid ${COLORS.border}` }}>
              <span style={{ width: 40, height: 40, flex: "0 0 auto", borderRadius: 10, background: COLORS.tealTint, color: COLORS.tealDark, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <ShieldCheck size={19} strokeWidth={1.6} />
              </span>
              <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>Staff roles</span>
                <span style={{ fontSize: 13, color: COLORS.slateMid }}>What each role can do, whether it reaches the back office, and where it lands after the PIN. Administrator only.</span>
              </span>
              <ChevronRight size={16} strokeWidth={1.8} color={COLORS.slateMid} />
            </Link>
          )}
          {canPayments && (
            <Link href="/settings/restaurant/payments" data-settings-payments style={{ display: "flex", alignItems: "center", gap: 16, padding: "18px 24px", color: COLORS.ink, textDecoration: "none", borderTop: restaurantView || canRoles ? `1px solid ${COLORS.border}` : undefined }}>
              <span style={{ width: 40, height: 40, flex: "0 0 auto", borderRadius: 10, background: COLORS.tealTint, color: COLORS.tealDark, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Wallet size={19} strokeWidth={1.6} />
              </span>
              <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>Payments</span>
                <span style={{ fontSize: 13, color: COLORS.slateMid }}>Whether a tablet&apos;s PAY asks for a tip. Tips go to the order&apos;s waiter.</span>
              </span>
              <ChevronRight size={16} strokeWidth={1.8} color={COLORS.slateMid} />
            </Link>
          )}
          {canAudit && (
            <Link href="/settings/restaurant/audit" data-settings-audit style={{ display: "flex", alignItems: "center", gap: 16, padding: "18px 24px", color: COLORS.ink, textDecoration: "none", borderTop: restaurantView || canRoles || canPayments ? `1px solid ${COLORS.border}` : undefined }}>
              <span style={{ width: 40, height: 40, flex: "0 0 auto", borderRadius: 10, background: COLORS.tealTint, color: COLORS.tealDark, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <ScrollText size={19} strokeWidth={1.6} />
              </span>
              <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>Audit log</span>
                <span style={{ fontSize: 13, color: COLORS.slateMid }}>Sign-ins, failed PINs, overrides, voids, drawer opens and PIN changes — by person and day.</span>
              </span>
              <ChevronRight size={16} strokeWidth={1.8} color={COLORS.slateMid} />
            </Link>
          )}
        </section>
      )}

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
          <Link href="/settings/scanner" style={{ display: "flex", alignItems: "center", gap: 16, padding: "18px 24px", color: COLORS.ink, textDecoration: "none", borderTop: `1px solid ${COLORS.border}` }}>
            <span style={{ width: 40, height: 40, flex: "0 0 auto", borderRadius: 10, background: COLORS.tealTint, color: COLORS.tealDark, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <ScanLine size={19} strokeWidth={1.6} />
            </span>
            <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>Scanner test</span>
              <span style={{ fontSize: 13, color: COLORS.slateMid }}>Scan a barcode to see the code and its timing, and tune this device&apos;s scanner. Also the camera and the customer display.</span>
            </span>
            <ChevronRight size={16} strokeWidth={1.8} color={COLORS.slateMid} />
          </Link>
          <Link href="/settings/devices" data-settings-devices style={{ display: "flex", alignItems: "center", gap: 16, padding: "18px 24px", color: COLORS.ink, textDecoration: "none", borderTop: `1px solid ${COLORS.border}` }}>
            <span style={{ width: 40, height: 40, flex: "0 0 auto", borderRadius: 10, background: COLORS.tealTint, color: COLORS.tealDark, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <MonitorSmartphone size={19} strokeWidth={1.6} />
            </span>
            <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>Devices</span>
              <span style={{ fontSize: 13, color: COLORS.slateMid }}>The tills, tablets and PCs that use the app: their names, when they were last seen{restaurantView ? ", and which restaurant view each one uses" : ""}.</span>
            </span>
            <ChevronRight size={16} strokeWidth={1.8} color={COLORS.slateMid} />
          </Link>
        </section>
      )}
    </div>
  );
}
