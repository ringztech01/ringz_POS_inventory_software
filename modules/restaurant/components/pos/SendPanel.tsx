"use client";

import { COURSE_LABEL, type Course } from "../../lib/posSpeed";
import { TOUCH } from "../../lib/theme";
import PanelFrame from "./PanelFrame";
import TouchButton from "./TouchButton";

const big = { fontFamily: TOUCH.display, fontSize: 22, fontWeight: 700, minHeight: 96 } as const;

// Send with courses on the check: everything waiting (held lines stay), or
// one course.
export default function SendPanel({ all, courses, held, onSend, onCancel }: { all: string[]; courses: { course: Course; lineIds: string[] }[]; held: number; onSend: (lineIds: string[] | null) => void; onCancel: () => void }) {
  return (
    <PanelFrame label="Send" title="Send to the kitchen" hint={held ? `${held} held stay back` : undefined} onCancel={onCancel}>
      <TouchButton data-send-all background={TOUCH.send} onClick={() => onSend(null)} style={big}>
        SEND ALL ({all.length})
      </TouchButton>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.max(courses.length, 1)}, minmax(0,1fr))`, gap: TOUCH.gap }}>
        {courses.map((c) => (
          <TouchButton key={c.course} data-send-course={c.course} background={TOUCH.key} onClick={() => onSend(c.lineIds)} style={big}>
            Send {COURSE_LABEL[c.course]} ({c.lineIds.length})
          </TouchButton>
        ))}
      </div>
    </PanelFrame>
  );
}
