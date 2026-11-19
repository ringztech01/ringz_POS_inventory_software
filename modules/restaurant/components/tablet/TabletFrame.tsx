import type { ReactNode } from "react";
import { T } from "./tabletTheme";

// A tablet screen's frame (Part 6g): the black header (96 px) with the
// screen's title and its right-hand parts, the body, and an optional black
// footer. The screens fill it in.
export default function TabletFrame({ title, right, footer, children }: { title: ReactNode; right?: ReactNode; footer?: ReactNode; children: ReactNode }) {
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column" }}>
      <header style={{ height: 96, flex: "none", display: "flex", alignItems: "center", gap: 14, padding: "0 24px", background: T.bar }}>
        <span style={{ fontSize: 38, fontWeight: 900, flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</span>
        {right}
      </header>
      <main style={{ flex: 1, minHeight: 0, position: "relative" }}>{children}</main>
      {footer && <footer style={{ flex: "none", background: T.bar }}>{footer}</footer>}
    </div>
  );
}
