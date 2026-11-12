// The audit view (Part 6f Step 7e): every recorded event as a plain line —
// its category (the view's filter chips), what happened and the details.
// Pure: the service hands in each row and the names it refers to.

export type AuditCategory = "SIGNIN" | "FAILED" | "OVERRIDE" | "VOID" | "DRAWER" | "PIN" | "STAFF" | "TILL" | "DEVICE";

export const CATEGORIES: readonly AuditCategory[] = ["SIGNIN", "FAILED", "OVERRIDE", "VOID", "DRAWER", "PIN", "STAFF", "TILL", "DEVICE"];
export const CATEGORY_LABEL: Record<AuditCategory, string> = {
  SIGNIN: "Sign-ins",
  FAILED: "Failed PINs",
  OVERRIDE: "Overrides",
  VOID: "Voids",
  DRAWER: "Drawer",
  PIN: "PINs & cards",
  STAFF: "Staff & roles",
  TILL: "Till & shifts",
  DEVICE: "Devices & settings",
};

export type Described = { category: AuditCategory; what: string; detail: string | null };
type Meta = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const num = (v: unknown) => (typeof v === "number" ? v : null);
const KIND: Record<string, string> = { void: "A void", refund: "A refund", drawer: "Opening the drawer", discount: "A discount over the limit", waste: "Waste over the limit" };
const KIND_LOWER: Record<string, string> = { void: "a void", refund: "a refund", drawer: "opening the drawer", discount: "a discount", waste: "waste" };

// An audit-log row. `name(id)`: a person's name ("Ada O.") or null.
export function describeAudit(action: string, metaIn: unknown, name: (id: unknown) => string | null): Described | null {
  const meta: Meta = metaIn && typeof metaIn === "object" && !Array.isArray(metaIn) ? (metaIn as Meta) : {};
  const card = meta.method === "card";
  switch (action) {
    case "auth.signin":
      return { category: "SIGNIN", what: "Signed in with email and password", detail: null };
    case "pin.signin":
      return { category: "SIGNIN", what: card ? "Signed in with a staff card" : "Signed in by PIN", detail: meta.tapped === true ? "Tapped their name first" : null };
    case "pos.switch":
      return { category: "SIGNIN", what: `Took over the till (${card ? "card" : "PIN"})`, detail: name(meta.from) ? `From ${name(meta.from)}` : null };
    case "recovery.use":
      return { category: "SIGNIN", what: "Signed in with the recovery code", detail: null };
    case "pin.signin.fail": {
      const locked = num(meta.lockedSeconds);
      return {
        category: "FAILED",
        what: card ? "Unknown card" : "Wrong PIN",
        detail: [locked ? `Device locked ${locked < 60 ? `${locked} s` : `${locked / 60} min`}` : num(meta.failures) ? `${meta.failures} in a row` : null, name(meta.tapped) ? `As ${name(meta.tapped)}` : null].filter(Boolean).join(" · ") || null,
      };
    }
    case "pin.signin.refused":
      return { category: "FAILED", what: "Refused on the Kitchen screen", detail: "Only Kitchen staff and managers sign in there" };
    case "recovery.fail":
      return { category: "FAILED", what: "Wrong recovery code", detail: str(meta.email) };
    case "staff.pin.set":
      return { category: "PIN", what: `Set ${str(meta.name) ?? "someone"}'s PIN`, detail: meta.pin === "generated" ? "Generated" : null };
    case "staff.pin.reset":
      return { category: "PIN", what: `Reset ${str(meta.name) ?? "someone"}'s PIN`, detail: meta.sessionsEnded ? "Signed out everywhere" : null };
    case "staff.pin.self":
      return { category: "PIN", what: "Changed their own PIN", detail: null };
    case "staff.card.set":
      return { category: "PIN", what: `Gave ${str(meta.name) ?? "someone"} a staff card`, detail: str(meta.card) };
    case "staff.card.remove":
      return { category: "PIN", what: `Took ${str(meta.name) ?? "someone"}'s staff card away`, detail: str(meta.card) };
    case "staff.create":
      return { category: "STAFF", what: `Added ${str(meta.name) ?? "someone"}`, detail: str(meta.role) };
    case "staff.update":
      return { category: "STAFF", what: `Edited ${str(meta.name) ?? "someone"}`, detail: meta.changed && typeof meta.changed === "object" ? `Changed ${Object.keys(meta.changed as object).join(", ")}` : null };
    case "staff.disable":
      return { category: "STAFF", what: `Disabled ${str(meta.name) ?? "someone"}`, detail: num(meta.transferred) ? `${meta.transferred} open order(s) to ${str(meta.to) ?? "someone"}` : null };
    case "staff.enable":
      return { category: "STAFF", what: `Enabled ${str(meta.name) ?? "someone"}`, detail: null };
    case "staff.training.on":
      return { category: "STAFF", what: `Put ${str(meta.name) ?? "someone"} in training mode`, detail: null };
    case "staff.training.off":
      return { category: "STAFF", what: `Took ${str(meta.name) ?? "someone"} out of training mode`, detail: null };
    case "staff.settings":
      return { category: "STAFF", what: "Changed the staff settings", detail: null };
    case "role.update":
      return { category: "STAFF", what: "Changed a role", detail: str(meta.name) ?? str(meta.role) };
    case "role.copy":
      return { category: "STAFF", what: "Copied a role", detail: str(meta.name) ?? str(meta.to) };
    case "shift.start":
      return { category: "TILL", what: "Started their shift", detail: null };
    case "shift.end":
      return { category: "TILL", what: meta.reason === "AUTO" ? "Shift closed (a new one started)" : "Ended their shift", detail: null };
    case "shift.handover":
      return { category: "TILL", what: `Handed ${num(meta.count) ?? "their"} table(s) to ${str(meta.to) ?? "someone"}`, detail: null };
    case "till.open":
      return { category: "TILL", what: "Opened the till", detail: str(meta.float) ? `Float ₦${meta.float}` : null };
    case "till.close": {
      const v = Number(meta.variance ?? 0);
      return { category: "TILL", what: "Closed the till", detail: `Expected ₦${meta.expected ?? "?"} · counted ₦${meta.counted ?? "?"} · ${v === 0 ? "balanced" : v > 0 ? `over ₦${v.toFixed(2)}` : `short ₦${Math.abs(v).toFixed(2)}`}` };
    }
    case "till.z.print":
      return { category: "TILL", what: meta.reprint ? "Reprinted a Z-report" : "Printed a Z-report", detail: str(meta.printer) };
    case "recovery.create":
      return { category: "PIN", what: meta.replaced ? "Made a new recovery code" : "Made a recovery code", detail: null };
    case "device.pin.pair":
      return { category: "DEVICE", what: `Paired ${str(meta.name) ?? "a device"}`, detail: meta.kind === "KITCHEN" ? "Kitchen screen" : meta.kind === "BAR" ? "Bar terminal" : "PIN terminal" };
    case "device.pin.unpair":
      return { category: "DEVICE", what: `Unpaired ${str(meta.name) ?? "a device"}`, detail: null };
    case "device.terminal.change":
      return { category: "DEVICE", what: `Changed what ${str(meta.name) ?? "a device"} is`, detail: meta.kind === "KITCHEN" ? "Kitchen screen" : meta.kind === "BAR" ? "Bar terminal" : "PIN terminal" };
    case "device.rename":
      return { category: "DEVICE", what: "Renamed a device", detail: `${str(meta.from) ?? "(no name)"} → ${str(meta.to) ?? "(no name)"}` };
    case "device.interface.set":
    case "restaurant.interface.set":
      return { category: "DEVICE", what: action === "device.interface.set" ? "Changed a device's view" : "Changed the restaurant's view", detail: str(meta.to) ?? str(meta.view) };
  }
  const override = /^override\.([a-z]+)(\.approve)?$/.exec(action);
  if (override) {
    const [, kind, approve] = override;
    return approve
      ? { category: "OVERRIDE", what: `Approved ${KIND_LOWER[kind] ?? kind} for ${name(meta.forUserId) ?? "someone"}`, detail: str(meta.reason) }
      : { category: "OVERRIDE", what: `${KIND[kind] ?? kind}, approved by ${name(meta.approvedById) ?? "a manager"}`, detail: str(meta.reason) ?? (str(meta.amount) ? `₦${meta.amount}` : null) };
  }
  return null;
}

// A voided line (sent, then cancelled — from the order screens).
export function describeVoid(v: { quantity: number; item: string; orderRef: string; reason: string | null }): Described {
  return { category: "VOID", what: `Voided ${v.quantity}× ${v.item} on ${v.orderRef}`, detail: v.reason };
}

const DRAWER_WHY: Record<string, string> = { MANUAL: "Opened the drawer by hand", CASH_SALE: "Drawer opened for a cash sale", CASH_REFUND: "Drawer opened for a cash refund", TEST: "Drawer test" };

export function describeDrawer(d: { reason: string; note: string | null; refLabel: string | null }): Described {
  return { category: "DRAWER", what: DRAWER_WHY[d.reason] ?? "Drawer opened", detail: d.note ?? d.refLabel };
}
