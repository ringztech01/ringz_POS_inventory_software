import { ArrowLeft, ShieldX } from "lucide-react";
import { COLORS, FONTS } from "@/components/layout/theme";
import GhostButton from "@/components/ui/GhostButton";

// The 403 state shown when a page is opened directly (by URL) without its
// permission. The nav already hides such pages — this is what a typed or
// bookmarked URL gets. Rendered inside the dashboard layout, so the sidebar
// still offers everything the user CAN open.
export default function ForbiddenState({ permission }: { permission: string }) {
  return (
    <div
      style={{
        background: "#fff",
        border: `1px solid ${COLORS.border}`,
        borderRadius: 12,
        boxShadow: "0 1px 2px rgba(23,27,28,.06)",
        padding: "56px 24px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 12,
        textAlign: "center",
      }}
    >
      <span
        style={{
          width: 48,
          height: 48,
          borderRadius: 12,
          background: COLORS.dangerBg,
          color: COLORS.danger,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <ShieldX size={22} strokeWidth={1.7} />
      </span>
      <span style={{ fontFamily: FONTS.mono, fontSize: 12, fontWeight: 600, letterSpacing: ".08em", color: COLORS.danger }}>
        403
      </span>
      <h1 style={{ margin: 0, fontFamily: FONTS.display, fontSize: 22, fontWeight: 700, letterSpacing: "-.015em" }}>
        You don&apos;t have access to this page
      </h1>
      <p style={{ margin: 0, fontSize: 13.5, color: COLORS.slateMid, maxWidth: 440 }}>
        It needs the <strong style={{ color: COLORS.text }}>{permission}</strong> permission. Ask an administrator to add
        it to your role.
      </p>
      <div style={{ marginTop: 8 }}>
        <GhostButton href="/profile" paddingX={18}>
          <ArrowLeft size={14} strokeWidth={1.7} />
          Go to my profile
        </GhostButton>
      </div>
    </div>
  );
}
