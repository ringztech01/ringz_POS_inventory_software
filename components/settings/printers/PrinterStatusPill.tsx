// A printer's status pill (Settings › Printers): Online, Offline, Paper out,
// Unknown — or Checking… before the first answer.
const PILL: Record<string, { label: string; bg: string; fg: string }> = {
  ONLINE: { label: "Online", bg: "#eff8f6", fg: "#0a6355" },
  OFFLINE: { label: "Offline", bg: "#fcecef", fg: "#b4233c" },
  PAPER_OUT: { label: "Paper out", bg: "#fff4e0", fg: "#8a5a00" },
  UNKNOWN: { label: "Unknown", bg: "#eef1f2", fg: "#4d5659" },
  CHECKING: { label: "Checking…", bg: "#eef1f2", fg: "#6d777a" },
};

export default function PrinterStatusPill({ status, detail }: { status: string; detail?: string | null }) {
  const pill = PILL[status] ?? PILL.UNKNOWN;
  return (
    <span
      data-status={status}
      title={detail ?? undefined}
      style={{ height: 22, width: "fit-content", padding: "0 9px", borderRadius: 11, background: pill.bg, color: pill.fg, fontSize: 11.5, fontWeight: 600, display: "inline-flex", alignItems: "center", whiteSpace: "nowrap" }}
    >
      {pill.label}
    </span>
  );
}
