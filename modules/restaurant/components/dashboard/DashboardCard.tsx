import type { ReactNode } from "react";
import { COLORS } from "@/components/layout/theme";

// A dashboard section: the design's white card with its title (and an
// optional note on the right). `failed` shows the section's own error
// instead of its content; `empty` shows a short message.
export default function DashboardCard({
  title,
  aside,
  failed,
  empty,
  gap,
  children,
}: {
  title: string;
  aside?: ReactNode;
  failed?: boolean;
  empty?: string | null;
  gap?: number;
  children?: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      style={{ background: "#fff", border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 18, display: "flex", flexDirection: "column", gap: gap ?? 0, minWidth: 0 }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: gap ? 0 : 12 }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{title}</h2>
        {!failed && aside}
      </div>
      {failed ? (
        <p role="alert" style={{ margin: 0, fontSize: 13, color: COLORS.danger }}>
          Couldn&apos;t load this section. Refresh to try again.
        </p>
      ) : empty ? (
        <p data-empty style={{ margin: 0, fontSize: 13, color: COLORS.slateMid }}>
          {empty}
        </p>
      ) : (
        children
      )}
    </section>
  );
}
