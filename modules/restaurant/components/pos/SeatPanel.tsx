"use client";

import { COURSE_LABEL, COURSES, type Course } from "../../lib/posSpeed";
import { TOUCH } from "../../lib/theme";
import PanelFrame, { doneKey } from "./PanelFrame";
import TouchButton from "./TouchButton";

// A seat or course key: amber while it's the one set (like a picked option).
function Choice({ on, label, data, disabled, onClick }: { on: boolean; label: string; data: Record<string, string>; disabled?: boolean; onClick: () => void }) {
  return (
    <TouchButton
      role="radio"
      aria-checked={on}
      {...data}
      disabled={disabled}
      background={on ? TOUCH.amber : TOUCH.key}
      color={on ? TOUCH.amberInk : "#fff"}
      pressedBackground={on ? undefined : TOUCH.keyDown}
      onClick={onClick}
      style={{ fontFamily: TOUCH.display, fontSize: 20, fontWeight: 700 }}
    >
      {label}
    </TouchButton>
  );
}

// Seat & course: for the line picked on the check (a sent line keeps its
// course), or — with no line picked — for the next dishes rung up. Each tap
// takes effect at once; Done closes.
export default function SeatPanel({
  target,
  seats,
  seat,
  course,
  courseLocked,
  onSeat,
  onCourse,
  onDone,
}: {
  // "Chk Jollof" or null (the next dishes).
  target: string | null;
  seats: number;
  seat: number | null;
  course: Course | null;
  courseLocked: boolean;
  onSeat: (seat: number | null) => void;
  onCourse: (course: Course | null) => void;
  onDone: () => void;
}) {
  const label = (text: string) => <span style={{ fontSize: 15, fontWeight: 700, color: TOUCH.textDim }}>{text}</span>;
  return (
    <PanelFrame
      label="Seat and course"
      title={<>Seat &amp; course for {target ?? "the next dishes"}</>}
      hint="Tap to set — it's saved at once"
      onCancel={onDone}
      footer={
        <TouchButton data-seat-done background={TOUCH.teal} onClick={onDone} style={doneKey}>
          Done
        </TouchButton>
      }
    >
      {label("Seat")}
      <div role="radiogroup" aria-label="Seat" style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0,1fr))", gridAutoRows: 64, gap: TOUCH.gap }}>
        <Choice on={seat === null} label="No seat" data={{ "data-seat": "none" }} onClick={() => onSeat(null)} />
        {Array.from({ length: seats }, (_, i) => i + 1).map((n) => (
          <Choice key={n} on={seat === n} label={String(n)} data={{ "data-seat": String(n) }} onClick={() => onSeat(n)} />
        ))}
      </div>
      {label(courseLocked ? "Course (sent — it keeps its course)" : "Course")}
      <div role="radiogroup" aria-label="Course" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gridAutoRows: 64, gap: TOUCH.gap, opacity: courseLocked ? 0.4 : 1 }}>
        <Choice on={course === null} label="No course" data={{ "data-course": "none" }} disabled={courseLocked} onClick={() => onCourse(null)} />
        {COURSES.map((c) => (
          <Choice key={c} on={course === c} label={COURSE_LABEL[c]} data={{ "data-course": c }} disabled={courseLocked} onClick={() => onCourse(c)} />
        ))}
      </div>
    </PanelFrame>
  );
}
