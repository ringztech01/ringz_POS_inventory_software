import { COLORS, FONTS } from "@/components/layout/theme";

export default function StatusChip({ time, date }: { time: string; date: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 1,
        fontFamily: FONTS.mono,
        fontSize: 11.5,
        color: COLORS.tealDark,
        background: COLORS.tealTint,
        border: `1px solid ${COLORS.focusRing}`,
        padding: "5px 10px",
        borderRadius: 8,
        justifySelf: "start",
        lineHeight: 1.35,
      }}
    >
      <span>{time}</span>
      <span>{date}</span>
    </span>
  );
}
