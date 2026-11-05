import type { ReservationStatus } from "@prisma/client";
import type { TableStatus } from "./tableStatus";

// Colours the restaurant designs use beyond the app palette
// (components/layout/theme.ts).
export const R = {
  // Row dividers inside a card.
  rowBorder: "#f0f2f3",
  // Text actions (Tables design).
  danger: "#b4233c",
  disabled: "#c2c9cb",
} as const;

// Status pills: [background, text] (Tables and Floor Plan designs).
export const TABLE_STATUS_PILL: Record<TableStatus, readonly [string, string]> = {
  Available: ["#eef1f2", "#4d5659"],
  Occupied: ["#eff8f6", "#0a6355"],
  Reserved: ["#fff4e0", "#8a5a00"],
  Cleaning: ["#eef1f2", "#6d777a"],
};

// Booking pills (Tables design; Cancelled isn't drawn there, so it's grey).
export const RESERVATION_PILL: Record<ReservationStatus, readonly [string, string]> = {
  BOOKED: ["#fff4e0", "#8a5a00"],
  SEATED: ["#eff8f6", "#0a6355"],
  CANCELLED: ["#eef1f2", "#6d777a"],
  NO_SHOW: ["#fdecef", "#b4233c"],
};

// Floor plan cards and legend (Floor Plan design).
export const FLOOR_CARD: Record<TableStatus, { background: string; color: string; border: string }> = {
  Available: { background: "#fff", color: "#171b1c", border: "1px solid #dde2e3" },
  Occupied: { background: "#0f7d6a", color: "#fff", border: "1px solid #0f7d6a" },
  Reserved: { background: "#fff4e0", color: "#8a5a00", border: "1px dashed #e0b565" },
  Cleaning: { background: "#eef1f2", color: "#6d777a", border: "1px solid #dde2e3" },
};

export const FLOOR_LEGEND: Record<TableStatus, string> = {
  Available: "#dde2e3",
  Occupied: "#0f7d6a",
  Reserved: "#e0b565",
  Cleaning: "#97a1a4",
};

// The selected card.
export const FLOOR_SELECTED = { border: "2px solid #171b1c", boxShadow: "0 6px 18px -6px rgba(23,27,28,.3)" } as const;

// Order line pills on the order screen (Table Order design). Ready isn't
// drawn there; it borrows the kitchen display's Ready teal, lightened.
export const LINE_STATUS_PILL: Record<"NEW" | "PENDING" | "PREPARING" | "READY" | "SERVED" | "CANCELLED", readonly [string, string]> = {
  NEW: ["#fff4e0", "#8a5a00"],
  PENDING: ["#e6f0fb", "#1d5fa8"],
  PREPARING: ["#e6f0fb", "#1d5fa8"],
  READY: ["#e6fbf6", "#0f7d6a"],
  SERVED: ["#eff8f6", "#0a6355"],
  CANCELLED: ["#eef1f2", "#6d777a"],
};

// Menu category chips and dish cards (Table Order design).
export const ORDER_SCREEN = {
  chipBorder: "#dde2e3",
  cardBorder: "#eceff0",
  cardHoverBorder: "#86cbc0",
  photo: "#eef1f2",
  unavailable: "#b4233c",
} as const;

// Restaurant Dashboard KPI tiles: [tile background, border, icon square, label/note ink].
export const KPI_TONES = {
  teal: { bg: "#eaf6f3", border: "#cfe9e2", accent: "#0f7d6a", ink: "#0a6355" },
  blue: { bg: "#eaf1fb", border: "#d3e2f6", accent: "#2f6fc0", ink: "#1d5fa8" },
  violet: { bg: "#f1edfb", border: "#e0d8f5", accent: "#6b4fc4", ink: "#553aa8" },
  amber: { bg: "#fdf4e3", border: "#f4e2bd", accent: "#c98a12", ink: "#8a5a00" },
  cyan: { bg: "#e6f5f8", border: "#c9e8ef", accent: "#1b8aa3", ink: "#136b80" },
  orange: { bg: "#fdefe6", border: "#f7d9c6", accent: "#d2662a", ink: "#a24a17" },
  green: { bg: "#ecf6e9", border: "#d4ebcd", accent: "#3d8b37", ink: "#2e6e29" },
  rose: { bg: "#fcecef", border: "#f5d3da", accent: "#b4233c", ink: "#b4233c" },
} as const;
export type KpiTone = keyof typeof KPI_TONES;

// Sales by hour: the peak hour's bar and the others.
export const HOUR_BAR = { peak: "#0f7d6a", other: "#9fd3c9" } as const;

// Order type mix: Dine-in, Takeaway, Delivery.
export const ORDER_TYPE_COLOR = { DINE_IN: "#0f7d6a", TAKEAWAY: "#5fb3a5", DELIVERY: "#c9e6e0" } as const;

// Low-stock pills: [background, text].
export const STOCK_LEVEL_PILL = { Critical: ["#fdecef", "#b4233c"], Low: ["#fff4e0", "#8a5a00"] } as const;

// Kitchen Display (dark; RingzPOS Kitchen Display design).
export const KDS = {
  bg: "#12181a",
  header: "#0b1011",
  card: "#1b2427",
  divider: "#243033",
  teal: "#0f7d6a",
  lateHead: "#8a1f33",
  lateBorder: "#b4233c",
  note: "#e0b565",
  text: "#eef1f2",
  soft: "#c9d1d3",
  muted: "#97a1a4",
  faint: "#6d777a",
  qty: "#5fd0bc",
  link: "#5fd0bc",
  lateText: "#ff8a9c",
  buttonBorder: "#3a4a4e",
} as const;

// The kitchen's line pills: [background, text].
export const KDS_STEP_PILL = {
  PENDING: ["#2f3b3e", "#c9d1d3"],
  PREPARING: ["#1d4f8a", "#cfe3fb"],
  READY: ["#0f7d6a", "#e6fbf6"],
} as const;
