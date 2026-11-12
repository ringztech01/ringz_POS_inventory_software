import type { ReactNode } from "react";
import { TOUCH } from "../../lib/theme";

// The check's width: the Restaurant POS design's 440 px, or 32 % on a wider
// screen. (The touch messages sit beside it — AppToaster.)
export const CHECK_WIDTH = "max(440px, 32%)";

// The touch POS's fixed zones (the Restaurant POS design), filling the
// window with nothing scrolling but the check's lines: the 52 px header on
// top, the check and the menu pad side by side, the 78 px function bar
// along the bottom. Landscape 1024 px and up.
export default function PosFrame({ header, check, menu, functions }: { header: ReactNode; check: ReactNode; menu: ReactNode; functions: ReactNode }) {
  return (
    <div
      data-pos-mode="restaurant"
      style={{
        position: "fixed",
        inset: 0,
        display: "grid",
        gridTemplateRows: "52px minmax(0,1fr) 78px",
        background: TOUCH.frame,
        color: TOUCH.text,
        // The design's type sits at the browser's normal line height (the
        // app's base style is 1.5).
        lineHeight: "normal",
        overflow: "hidden",
        userSelect: "none",
        WebkitUserSelect: "none",
      }}
    >
      {header}
      <div style={{ display: "grid", gridTemplateColumns: `${CHECK_WIDTH} minmax(0,1fr)`, gap: TOUCH.gap, padding: TOUCH.gap, minHeight: 0, minWidth: 0 }}>
        {check}
        {menu}
      </div>
      {functions}
    </div>
  );
}
