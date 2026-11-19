// The tablet screens' look (Part 6g, design: RingzPOS Tablet.dc.html): the
// system font only, flat colour blocks — no shadows, gradients, blur or
// images — so they stay fast on a low-cost Android tablet. Press states
// only, never longer than 120 ms. Labels and numbers in 800–900.

export const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

export const T = {
  bg: "#0E0F11",
  bar: "#000",
  button: "#1C1F23",
  buttonAlt: "#24272B",
  raised: "#16181B",
  edge: "#2A2E33",
  text: "#fff",
  quiet: "#9AA1A8",
  soft: "#C4CAD0",
  danger: "#FF6B6B",
  lockBg: "#5A1A1A",
  lockFg: "#FFB4B4",
  ok: "#2BD67B",
  teal: "#0B8A73",
  pay: "#0F8A45",
  // Departments (Food / Bar).
  food: "#EA580C",
  bar2: "#2563EB",
} as const;

// Table states — the same colours as the desktop POS: [label, fill, outline].
export const TABLE_STATE = {
  FREE: { label: "Free", bg: "#1C1F23", ring: "inset 0 0 0 4px #2BD67B" },
  SEATED: { label: "Seated", bg: "#1F5FD6", ring: "none" },
  SENT: { label: "Food sent", bg: "#D9650B", ring: "none" },
  BILL: { label: "Bill printed", bg: "#6D3FCF", ring: "none" },
  LATE: { label: "Waiting long", bg: "#C81E1E", ring: "inset 0 0 0 4px #FFB4B4" },
  RESERVED: { label: "Reserved", bg: "#2A2E33", ring: "inset 0 0 0 4px #F5B700" },
} as const;

// Touch targets: at least 52 px; main actions 84–132 px.
export const TOUCH_MIN = 52;

// The press state every tablet button shares (120 ms at most).
export const PRESS_CSS = `
.tb-press { transition: filter 80ms ease-out, background-color 80ms ease-out; -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
.tb-press:active { filter: brightness(.8); }
`;
