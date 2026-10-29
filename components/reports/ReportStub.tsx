import { BarChart3 } from "lucide-react";
import { COLORS } from "@/components/layout/theme";

// Placeholder body for a report tab that isn't built yet.
export default function ReportStub({ title }: { title: string }) {
  return (
    <div
      style={{
        background: "#fff",
        border: `1px solid ${COLORS.border}`,
        borderRadius: 12,
        boxShadow: "0 1px 2px rgba(23,27,28,.06)",
        padding: "44px 22px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 10,
      }}
    >
      <span
        style={{
          width: 40,
          height: 40,
          borderRadius: 11,
          background: COLORS.bgApp,
          color: COLORS.slateLight,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <BarChart3 size={19} strokeWidth={1.6} />
      </span>
      <span style={{ fontSize: 13.5, color: COLORS.slateMid }}>{title} — coming soon.</span>
    </div>
  );
}
