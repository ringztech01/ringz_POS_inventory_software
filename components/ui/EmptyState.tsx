import type { LucideIcon } from "lucide-react";
import { COLORS } from "@/components/layout/theme";

export default function EmptyState({ icon: Icon, message }: { icon: LucideIcon; message: string }) {
  return (
    <div style={{ padding: "44px 22px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
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
        <Icon size={19} strokeWidth={1.6} />
      </span>
      <span style={{ fontSize: 13.5, color: COLORS.slateMid }}>{message}</span>
    </div>
  );
}
