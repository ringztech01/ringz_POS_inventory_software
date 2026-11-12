"use client";

import { useState, useTransition, type CSSProperties, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { CreditCard, Download, GraduationCap, KeyRound, LifeBuoy, Pencil, Plus, Power, Printer, ShieldAlert, Shuffle, UserPlus } from "lucide-react";
import { COLORS, FONTS } from "@/components/layout/theme";
import { defaultDisplayName, PIN_LENGTH, STAFF_COLOURS } from "../../lib/staffPins";
import { HOME_INFO } from "../../lib/staffRoles";
import { createStaff, disableStaff, enableStaff, saveStaffSettings, setStaffPin, updateStaff } from "../../server/actions/staff";
import { makeRecoveryCode, savePinHideNames } from "../../server/actions/pinSignIn";
import { saveClockInOut } from "../../server/actions/session";
import { removeStaffCard, setStaffCard } from "../../server/actions/staffCard";
import { setTrainingMode } from "../../server/actions/training";
import type { StaffPage, StaffRow } from "../../server/services/staff";

// Settings › Staff (Part 6f Step 3; Administrator only): everyone who uses
// the app — add staff (they sign in by PIN), set or reset a PIN (typed
// twice, or generated and shown once), edit, disable (their open orders go
// to someone else first) and enable; the PIN rules.

const UNREACHABLE = "Couldn't reach the server. Check the connection and try again.";
const initials = (r: { firstName: string; lastName: string }) => `${r.firstName.charAt(0)}${r.lastName.charAt(0)}`.toUpperCase();
const input: CSSProperties = { height: 40, border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: "0 12px", fontSize: 14, width: "100%", background: "#fff" };
const label: CSSProperties = { display: "flex", flexDirection: "column", gap: 6, fontSize: 13, fontWeight: 600, color: COLORS.ink };
const pinInput: CSSProperties = { ...input, fontSize: 20, letterSpacing: ".5em", textAlign: "center", fontFamily: FONTS.mono };
const button = (tone: "go" | "plain" | "bad" = "plain"): CSSProperties => ({
  height: 38,
  padding: "0 16px",
  borderRadius: 8,
  border: tone === "plain" ? `1px solid ${COLORS.border}` : "none",
  background: tone === "go" ? COLORS.teal : tone === "bad" ? COLORS.danger : "#fff",
  color: tone === "plain" ? COLORS.ink : "#fff",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  gap: 6,
});

type Dialog =
  | { kind: "add" }
  | { kind: "edit"; row: StaffRow }
  | { kind: "pin"; row: StaffRow }
  | { kind: "card"; row: StaffRow }
  | { kind: "shown"; name: string; pin: string }
  | { kind: "recovery"; code: string }
  | { kind: "disable"; row: StaffRow; transfer?: { orders: { id: string; ref: string; table: string | null }[]; to: { id: string; name: string }[] } };

export type PinScreenSettings = { hideNames: boolean; clockInOut: boolean; recoveryMadeAt: string | null };

export default function StaffPanel({ data, pinScreen }: { data: StaffPage; pinScreen: PinScreenSettings }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [filter, setFilter] = useState<"active" | "disabled" | "all">("active");
  const [busy, startBusy] = useTransition();
  const shown = data.staff.filter((s) => (filter === "all" ? true : filter === "active" ? !s.disabled : s.disabled));
  const counts = { active: data.staff.filter((s) => !s.disabled).length, disabled: data.staff.filter((s) => s.disabled).length };

  const run = <T extends { ok: boolean; error?: string }>(work: () => Promise<T>, done: (result: T & { ok: true }) => void) =>
    startBusy(async () => {
      const result = await work().catch(() => ({ ok: false, error: UNREACHABLE }) as unknown as T);
      if (!result.ok) return void toast.error(result.error ?? "Something went wrong.");
      done(result as T & { ok: true });
      router.refresh();
    });

  function toggleSetting(key: "allowWeakPins" | "staffSelfPin") {
    const next = { ...data.settings, [key]: !data.settings[key] };
    run(() => saveStaffSettings(next), () => toast.success("Saved."));
  }

  function newRecoveryCode() {
    if (pinScreen.recoveryMadeAt && !window.confirm("Make a new recovery code? The one made before stops working.")) return;
    run(() => makeRecoveryCode(), (result) => setDialog({ kind: "recovery", code: result.code }));
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, maxWidth: 720 }}>
          <h1 style={{ margin: 0, fontFamily: FONTS.display, fontSize: 24, fontWeight: 600, letterSpacing: "-.01em" }}>Staff</h1>
          <p style={{ margin: 0, fontSize: 13.5, color: COLORS.slateMid, lineHeight: 1.5 }}>
            Everyone who uses the app. Staff added here sign in with a {PIN_LENGTH}-digit PIN — never an email or password. Disable someone instead of deleting them, so their sales and orders stay theirs. Only an Administrator can change this page.
          </p>
        </div>
        <button type="button" data-staff-add onClick={() => setDialog({ kind: "add" })} style={button("go")}>
          <UserPlus size={16} /> Add staff
        </button>
      </div>

      <section aria-label="PIN rules" style={{ background: "#fff", border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: "14px 18px", display: "flex", gap: 28, flexWrap: "wrap" }}>
        {(
          [
            ["allowWeakPins", "Allow easy PINs", "Like 1234, 0000 or 2580. Off: they're refused."],
            ["staffSelfPin", "Staff may change their own PIN", "On My PIN, with their current one. Off: only you set PINs."],
          ] as const
        ).map(([key, title, about]) => (
          <label key={key} style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", maxWidth: 360 }}>
            <input type="checkbox" data-staff-setting={key} checked={data.settings[key]} disabled={busy} onChange={() => toggleSetting(key)} style={{ width: 18, height: 18, marginTop: 1, accentColor: COLORS.teal }} />
            <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{title}</span>
              <span style={{ fontSize: 12.5, color: COLORS.slateMid }}>{about}</span>
            </span>
          </label>
        ))}
        <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", maxWidth: 360 }}>
          <input type="checkbox" data-staff-setting="hidePinNames" checked={pinScreen.hideNames} disabled={busy} onChange={() => run(() => savePinHideNames(!pinScreen.hideNames), () => toast.success("Saved."))} style={{ width: 18, height: 18, marginTop: 1, accentColor: COLORS.teal }} />
          <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>Hide names on the PIN screen</span>
            <span style={{ fontSize: 12.5, color: COLORS.slateMid }}>No &ldquo;on shift&rdquo; list on PIN terminals: staff just type their PIN.</span>
          </span>
        </label>
        <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", maxWidth: 360 }}>
          <input type="checkbox" data-staff-setting="clockInOut" checked={pinScreen.clockInOut} disabled={busy} onChange={() => run(() => saveClockInOut(!pinScreen.clockInOut), () => toast.success("Saved."))} style={{ width: 18, height: 18, marginTop: 1, accentColor: COLORS.teal }} />
          <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>Clock in / out</span>
            <span style={{ fontSize: 12.5, color: COLORS.slateMid }}>&ldquo;Start shift?&rdquo; after a PIN sign-in, &ldquo;End shift?&rdquo; at LOCK. The PIN screen lists who&apos;s on shift.</span>
          </span>
        </label>
      </section>

      <section aria-label="Recovery code" data-recovery-card style={{ background: "#fff", border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: "14px 18px", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <LifeBuoy size={22} color={COLORS.slateMid} />
        <span style={{ display: "flex", flexDirection: "column", gap: 2, flex: "1 1 360px" }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>Recovery code</span>
          <span data-recovery-status style={{ fontSize: 12.5, color: COLORS.slateMid, lineHeight: 1.5 }}>
            {pinScreen.recoveryMadeAt ? `Made ${pinScreen.recoveryMadeAt}, not used yet.` : "None yet."} If every Administrator&apos;s PIN or password is lost, an Administrator signs in once with their email and this code (on the email sign-in, not on a PIN terminal). Print it and keep it somewhere safe.
          </span>
        </span>
        <button type="button" data-recovery-make onClick={newRecoveryCode} disabled={busy} style={button(pinScreen.recoveryMadeAt ? "plain" : "go")}>
          <KeyRound size={16} /> {pinScreen.recoveryMadeAt ? "Make a new code" : "Make a recovery code"}
        </button>
      </section>

      <div role="tablist" aria-label="Show" style={{ display: "flex", gap: 4 }}>
        {(
          [
            ["active", `Active · ${counts.active}`],
            ["disabled", `Disabled · ${counts.disabled}`],
            ["all", "All"],
          ] as const
        ).map(([key, text]) => (
          <button key={key} type="button" role="tab" aria-selected={filter === key} data-staff-filter={key} onClick={() => setFilter(key)} style={{ height: 32, padding: "0 12px", borderRadius: 8, border: "none", background: filter === key ? COLORS.teal : "transparent", color: filter === key ? "#fff" : COLORS.slate, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
            {text}
          </button>
        ))}
      </div>

      <section style={{ background: "#fff", border: `1px solid ${COLORS.border}`, borderRadius: 12, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
          <thead>
            <tr style={{ textAlign: "left", fontSize: 12, color: COLORS.slateMid, textTransform: "uppercase", letterSpacing: ".04em" }}>
              {["", "Name", "Role", "Status", "PIN", "Last login", "Device last used", ""].map((h, i) => (
                <th key={i} style={{ padding: "10px 14px", fontWeight: 600, whiteSpace: "nowrap" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={row.id} data-staff-row={`${row.firstName} ${row.lastName}`} style={{ borderTop: `1px solid ${COLORS.border}`, opacity: row.disabled ? 0.6 : 1 }}>
                <td style={{ padding: "10px 14px", width: 48 }}>
                  {row.image ? (
                    // eslint-disable-next-line @next/next/no-img-element -- a small avatar from uploads, as on Peoples › Users
                    <img src={row.image} alt="" style={{ width: 36, height: 36, borderRadius: "50%", objectFit: "cover" }} />
                  ) : (
                    <span aria-hidden style={{ width: 36, height: 36, borderRadius: "50%", background: row.colour ?? COLORS.slate, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700 }}>
                      {initials(row)}
                    </span>
                  )}
                </td>
                <td style={{ padding: "10px 14px" }}>
                  <div style={{ fontWeight: 600 }}>
                    {row.firstName} {row.lastName}
                    {row.training && (
                      <span data-staff-training style={{ marginLeft: 8, fontSize: 11, fontWeight: 800, letterSpacing: ".05em", color: "#7A4D00", background: "#FFF2DB", padding: "2px 7px", borderRadius: 999 }}>
                        TRAINING
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12.5, color: COLORS.slateMid }}>
                    {row.displayName} · {row.email ?? "PIN only"}
                  </div>
                </td>
                <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>{row.role?.name ?? <span style={{ color: COLORS.danger }}>No role</span>}</td>
                <td style={{ padding: "10px 14px" }}>
                  <span data-staff-status style={{ fontSize: 12, fontWeight: 700, padding: "3px 8px", borderRadius: 999, background: row.disabled ? COLORS.bgApp : COLORS.tealTint, color: row.disabled ? COLORS.slate : COLORS.tealDark }}>
                    {row.disabled ? "Disabled" : "Active"}
                  </span>
                </td>
                <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }} data-staff-pin={row.pin}>
                  {row.pin === "SET" ? "Set" : row.pin === "NONE" ? <span style={{ color: COLORS.slateMid }}>Not set</span> : <span style={{ color: "#9A5B00", display: "inline-flex", alignItems: "center", gap: 4 }}><ShieldAlert size={14} /> Old PIN — reset</span>}
                  {row.card && (
                    <span data-staff-card={row.card} title="Staff card" style={{ marginLeft: 8, color: COLORS.slateMid, display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <CreditCard size={14} /> {row.card}
                    </span>
                  )}
                </td>
                <td style={{ padding: "10px 14px", whiteSpace: "nowrap", color: COLORS.slateMid }}>{row.lastLogin ?? "Never"}</td>
                <td style={{ padding: "10px 14px", whiteSpace: "nowrap", color: COLORS.slateMid }}>{row.lastDevice ?? "—"}</td>
                <td style={{ padding: "10px 14px" }}>
                  <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                    <IconButton title="Edit" data="edit" onClick={() => setDialog({ kind: "edit", row })} icon={<Pencil size={15} />} />
                    <IconButton title={row.pin === "NONE" ? "Set PIN" : "Reset PIN"} data="pin" onClick={() => setDialog({ kind: "pin", row })} icon={<KeyRound size={15} />} />
                    <IconButton title={row.card ? "Staff card" : "Give a staff card"} data="card" onClick={() => setDialog({ kind: "card", row })} icon={<CreditCard size={15} />} />
                    <IconButton
                      title={row.training ? "End training mode" : "Training mode"}
                      data="training"
                      onClick={() => run(() => setTrainingMode({ id: row.id, on: !row.training }), () => toast.success(row.training ? `${row.firstName} is out of training: their next orders are real.` : `${row.firstName} is in training: their orders are practice ones.`))}
                      icon={<GraduationCap size={15} />}
                    />
                    {row.disabled ? (
                      <IconButton title="Enable" data="enable" onClick={() => run(() => enableStaff({ id: row.id }), () => toast.success(`${row.firstName} can sign in again.`))} icon={<Power size={15} />} />
                    ) : (
                      <IconButton title="Disable" data="disable" tone="bad" onClick={() => setDialog({ kind: "disable", row })} icon={<Power size={15} />} />
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!shown.length && (
              <tr>
                <td colSpan={8} style={{ padding: 24, color: COLORS.slateMid }}>
                  Nobody here.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {(dialog?.kind === "add" || dialog?.kind === "edit") && (
        <StaffDialog
          data={data}
          row={dialog.kind === "edit" ? dialog.row : null}
          busy={busy}
          onClose={() => setDialog(null)}
          onSave={(fields, pin) => {
            if (dialog.kind === "edit") {
              run(() => updateStaff({ id: dialog.row.id, ...fields }), () => {
                toast.success("Saved.");
                setDialog(null);
              });
            } else {
              run(() => createStaff({ ...fields, pin: pin! }), (result) => {
                toast.success(`${fields.firstName} added.`);
                setDialog(result.pin ? { kind: "shown", name: fields.firstName, pin: result.pin } : null);
              });
            }
          }}
        />
      )}
      {dialog?.kind === "pin" && (
        <Modal title={`${dialog.row.pin === "NONE" ? "Set" : "Reset"} ${dialog.row.firstName}'s PIN`} onClose={() => setDialog(null)} data="pin-dialog">
          {dialog.row.pin !== "NONE" && <p style={{ margin: 0, fontSize: 13, color: "#9A5B00" }}>A new PIN signs {dialog.row.firstName} out everywhere: every device they&apos;re on goes back to the sign-in.</p>}
          <PinFields
            busy={busy}
            onCancel={() => setDialog(null)}
            onDone={(pin) =>
              run(() => setStaffPin({ id: dialog.row.id, pin }), (result) => {
                toast.success(result.reset ? `${dialog.row.firstName}'s PIN reset — signed out everywhere.` : `${dialog.row.firstName}'s PIN set.`);
                setDialog(result.pin ? { kind: "shown", name: dialog.row.firstName, pin: result.pin } : null);
              })
            }
          />
        </Modal>
      )}
      {dialog?.kind === "shown" && (
        <Modal title={`${dialog.name}'s PIN`} onClose={() => setDialog(null)} data="pin-shown">
          <p style={{ margin: 0, fontSize: 13.5, color: COLORS.slate, lineHeight: 1.5 }}>Hand this to {dialog.name} now. It won&apos;t be shown again — not here, not anywhere.</p>
          <div data-pin-value style={{ fontFamily: FONTS.mono, fontSize: 44, fontWeight: 700, letterSpacing: ".35em", textAlign: "center", padding: "14px 0", background: COLORS.bgApp, borderRadius: 10 }}>
            {dialog.pin}
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button type="button" data-pin-done onClick={() => setDialog(null)} style={button("go")}>
              Done — it&apos;s handed over
            </button>
          </div>
        </Modal>
      )}
      {dialog?.kind === "card" && (
        <CardDialog
          row={dialog.row}
          busy={busy}
          onClose={() => setDialog(null)}
          onSave={(code) => run(() => setStaffCard({ id: dialog.row.id, code }), (r) => (toast.success(`${dialog.row.firstName}'s card (${r.label}) signs them in now.`), setDialog(null)))}
          onRemove={() => run(() => removeStaffCard(dialog.row.id), () => (toast.success(`${dialog.row.firstName}'s card no longer signs in.`), setDialog(null)))}
        />
      )}
      {dialog?.kind === "recovery" && (
        <Modal title="Your recovery code" onClose={() => setDialog(null)} data="recovery-shown">
          <p style={{ margin: 0, fontSize: 13.5, color: COLORS.slate, lineHeight: 1.5 }}>
            Print it or save it now and keep it somewhere safe (not on this device). It won&apos;t be shown again. It works once: an Administrator&apos;s email and this code, on the email sign-in&apos;s &ldquo;Use a recovery code&rdquo;.
          </p>
          <div data-recovery-value style={{ fontFamily: FONTS.mono, fontSize: 24, fontWeight: 700, letterSpacing: ".08em", textAlign: "center", padding: "16px 0", background: COLORS.bgApp, borderRadius: 10, userSelect: "all" }}>
            {dialog.code}
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
            <button type="button" data-recovery-print onClick={() => printRecoveryCode(dialog.code)} style={button()}>
              <Printer size={16} /> Print
            </button>
            <button type="button" data-recovery-download onClick={() => downloadRecoveryCode(dialog.code)} style={button()}>
              <Download size={16} /> Download
            </button>
            <button type="button" data-recovery-done onClick={() => setDialog(null)} style={button("go")}>
              Done — it&apos;s kept safe
            </button>
          </div>
        </Modal>
      )}
      {dialog?.kind === "disable" && (
        <DisableDialog
          row={dialog.row}
          transfer={dialog.transfer}
          busy={busy}
          onClose={() => setDialog(null)}
          onDisable={(transferTo) =>
            startBusy(async () => {
              const result = await disableStaff({ id: dialog.row.id, transferTo }).catch(() => ({ ok: false as const, error: UNREACHABLE }));
              if (!result.ok) {
                if ("needsTransfer" in result) return setDialog({ kind: "disable", row: dialog.row, transfer: result.needsTransfer });
                return void toast.error(result.error);
              }
              toast.success(result.transferred ? `${dialog.row.firstName} disabled — ${result.transferred} order${result.transferred === 1 ? "" : "s"} moved.` : `${dialog.row.firstName} disabled and signed out everywhere.`);
              setDialog(null);
              router.refresh();
            })
          }
        />
      )}
    </div>
  );
}

function IconButton({ title, icon, onClick, data, tone }: { title: string; icon: ReactNode; onClick: () => void; data: string; tone?: "bad" }) {
  return (
    <button type="button" title={title} aria-label={title} data-staff-action={data} onClick={onClick} style={{ width: 32, height: 32, borderRadius: 8, border: `1px solid ${COLORS.border}`, background: "#fff", color: tone === "bad" ? COLORS.danger : COLORS.slate, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
      {icon}
    </button>
  );
}

function Modal({ title, children, onClose, data }: { title: string; children: ReactNode; onClose: () => void; data: string }) {
  return (
    <div role="dialog" aria-modal="true" aria-label={title} data-staff-dialog={data} onPointerDown={(e) => e.target === e.currentTarget && onClose()} style={{ position: "fixed", inset: 0, zIndex: 80, background: "rgba(23,27,28,.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ width: 480, maxWidth: "100%", maxHeight: "calc(100vh - 32px)", overflowY: "auto", background: "#fff", borderRadius: 12, padding: 22, display: "flex", flexDirection: "column", gap: 14, boxShadow: "0 16px 40px rgba(0,0,0,.25)" }}>
        <span style={{ fontFamily: FONTS.display, fontSize: 18, fontWeight: 700 }}>{title}</span>
        {children}
      </div>
    </div>
  );
}

type Fields = { firstName: string; lastName: string; displayName: string; roleId: string; colour: (typeof STAFF_COLOURS)[number] | null; homeAreaId: string | null; homeStation: string | null };
type PinChoice = { generate: true } | { pin: string; confirm: string };

function StaffDialog({ data, row, busy, onClose, onSave }: { data: StaffPage; row: StaffRow | null; busy: boolean; onClose: () => void; onSave: (fields: Fields, pin: PinChoice | null) => void }) {
  const [f, setF] = useState<Fields>({
    firstName: row?.firstName ?? "",
    lastName: row?.lastName ?? "",
    displayName: row && row.displayName !== defaultDisplayName(row.firstName, row.lastName) ? row.displayName : "",
    roleId: row?.role?.id ?? data.roles.find((r) => r.name === "Waiter")?.id ?? data.roles[0]?.id ?? "",
    colour: (row?.colour as Fields["colour"]) ?? null,
    homeAreaId: row?.homeAreaId ?? null,
    homeStation: row?.homeStation ?? null,
  });
  const [pinMode, setPinMode] = useState<"type" | "generate">("generate");
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const set = (change: Partial<Fields>) => setF((now) => ({ ...now, ...change }));
  const home = data.roles.find((r) => r.id === f.roleId)?.homeScreen ?? "TABLES";
  const pinReady = pinMode === "generate" || (pin.length === PIN_LENGTH && confirm.length === PIN_LENGTH);
  const ready = f.firstName.trim() && f.lastName.trim() && f.roleId && (row || pinReady) && !busy;
  return (
    <Modal title={row ? `Edit ${row.firstName}` : "Add staff"} onClose={onClose} data={row ? "edit" : "add"}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <label style={label}>
          First name
          <input data-staff-first autoFocus value={f.firstName} maxLength={50} onChange={(e) => set({ firstName: e.target.value })} style={input} />
        </label>
        <label style={label}>
          Last name
          <input data-staff-last value={f.lastName} maxLength={50} onChange={(e) => set({ lastName: e.target.value })} style={input} />
        </label>
      </div>
      <label style={label}>
        Display name <span style={{ fontWeight: 400, color: COLORS.slateMid }}>— on tickets</span>
        <input data-staff-display value={f.displayName} maxLength={40} placeholder={f.firstName ? defaultDisplayName(f.firstName, f.lastName) : "Ada O."} onChange={(e) => set({ displayName: e.target.value })} style={input} />
      </label>
      <label style={label}>
        Role
        <select data-staff-role value={f.roleId} onChange={(e) => set({ roleId: e.target.value, homeAreaId: null, homeStation: null })} style={input}>
          {data.roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
      {HOME_INFO[home].station ? (
        <label style={label}>
          Kitchen station <span style={{ fontWeight: 400, color: COLORS.slateMid }}>— their kitchen display</span>
          <select data-staff-station value={f.homeStation ?? ""} onChange={(e) => set({ homeStation: e.target.value || null })} style={input}>
            <option value="">The role&apos;s</option>
            {data.stations.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <label style={label}>
          Default area <span style={{ fontWeight: 400, color: COLORS.slateMid }}>— where their Tables screen opens</span>
          <select data-staff-area value={f.homeAreaId ?? ""} onChange={(e) => set({ homeAreaId: e.target.value || null })} style={input}>
            <option value="">The role&apos;s</option>
            {data.areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <div style={label}>
        Colour <span style={{ fontWeight: 400, color: COLORS.slateMid }}>— optional, their badge on the POS</span>
        <div style={{ display: "flex", gap: 6 }}>
          <button type="button" aria-label="No colour" aria-pressed={!f.colour} onClick={() => set({ colour: null })} style={{ width: 28, height: 28, borderRadius: "50%", border: `2px solid ${!f.colour ? COLORS.ink : COLORS.border}`, background: "#fff", cursor: "pointer" }} />
          {STAFF_COLOURS.map((c) => (
            <button key={c} type="button" data-staff-colour={c} aria-label={c} aria-pressed={f.colour === c} onClick={() => set({ colour: c })} style={{ width: 28, height: 28, borderRadius: "50%", border: f.colour === c ? `3px solid ${COLORS.ink}` : "3px solid #fff", boxShadow: `0 0 0 1px ${COLORS.border}`, background: c, cursor: "pointer" }} />
          ))}
        </div>
      </div>
      {!row && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, borderTop: `1px solid ${COLORS.border}`, paddingTop: 12 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Their PIN</span>
          <div style={{ display: "flex", gap: 6 }}>
            {(
              [
                ["generate", "Generate one", <Shuffle key="g" size={14} />],
                ["type", "Type one", <KeyRound key="t" size={14} />],
              ] as const
            ).map(([mode, text, icon]) => (
              <button key={mode} type="button" data-pin-mode={mode} aria-pressed={pinMode === mode} onClick={() => setPinMode(mode)} style={{ ...button(pinMode === mode ? "go" : "plain"), height: 34 }}>
                {icon} {text}
              </button>
            ))}
          </div>
          {pinMode === "generate" ? (
            <span style={{ fontSize: 12.5, color: COLORS.slateMid }}>A random {PIN_LENGTH}-digit PIN, shown once after you add them.</span>
          ) : (
            <TwoPins pin={pin} confirm={confirm} setPin={setPin} setConfirm={setConfirm} />
          )}
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button type="button" onClick={onClose} style={button()}>
          Cancel
        </button>
        <button type="button" data-staff-save disabled={!ready} onClick={() => onSave(f, row ? null : pinMode === "generate" ? { generate: true } : { pin, confirm })} style={{ ...button("go"), opacity: ready ? 1 : 0.5 }}>
          {row ? "Save" : (
            <>
              <Plus size={15} /> Add
            </>
          )}
        </button>
      </div>
    </Modal>
  );
}

function TwoPins({ pin, confirm, setPin, setConfirm }: { pin: string; confirm: string; setPin: (v: string) => void; setConfirm: (v: string) => void }) {
  const digits = (v: string) => v.replace(/\D/g, "").slice(0, PIN_LENGTH);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
      <label style={label}>
        PIN
        <input data-pin-1 type="password" inputMode="numeric" autoComplete="new-password" value={pin} onChange={(e) => setPin(digits(e.target.value))} style={pinInput} />
      </label>
      <label style={label}>
        Again
        <input data-pin-2 type="password" inputMode="numeric" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(digits(e.target.value))} style={pinInput} />
      </label>
    </div>
  );
}

function PinFields({ busy, onCancel, onDone }: { busy: boolean; onCancel: () => void; onDone: (pin: PinChoice) => void }) {
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const ready = pin.length === PIN_LENGTH && confirm.length === PIN_LENGTH && !busy;
  return (
    <>
      <TwoPins pin={pin} confirm={confirm} setPin={setPin} setConfirm={setConfirm} />
      <span style={{ fontSize: 12.5, color: COLORS.slateMid }}>{PIN_LENGTH} digits that nobody else has. Easy ones (1234, 0000, 2580, repeats, runs) are refused unless you allow them.</span>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <button type="button" data-pin-generate disabled={busy} onClick={() => onDone({ generate: true })} style={button()}>
          <Shuffle size={14} /> Generate one
        </button>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" onClick={onCancel} style={button()}>
            Cancel
          </button>
          <button type="button" data-pin-save disabled={!ready} onClick={() => onDone({ pin, confirm })} style={{ ...button("go"), opacity: ready ? 1 : 0.5 }}>
            Save PIN
          </button>
        </div>
      </div>
    </>
  );
}

function DisableDialog({ row, transfer, busy, onClose, onDisable }: { row: StaffRow; transfer?: { orders: { id: string; ref: string; table: string | null }[]; to: { id: string; name: string }[] }; busy: boolean; onClose: () => void; onDisable: (transferTo: string | null) => void }) {
  const [to, setTo] = useState(transfer?.to[0]?.id ?? "");
  return (
    <Modal title={`Disable ${row.firstName} ${row.lastName}?`} onClose={onClose} data="disable">
      <p style={{ margin: 0, fontSize: 13.5, color: COLORS.slate, lineHeight: 1.5 }}>They can&apos;t sign in any more and are signed out on every device. Their sales and orders stay theirs; you can enable them again later.</p>
      {transfer && (
        <div data-transfer style={{ display: "flex", flexDirection: "column", gap: 8, background: "#FFF8EC", borderRadius: 10, padding: 12 }}>
          <span style={{ fontSize: 13.5, fontWeight: 600, color: "#9A5B00" }}>
            {row.firstName} has {transfer.orders.length} open order{transfer.orders.length === 1 ? "" : "s"}. Give {transfer.orders.length === 1 ? "it" : "them"} to:
          </span>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
            {transfer.orders.map((o) => (
              <li key={o.id}>
                {o.ref}
                {o.table ? ` · ${o.table}` : ""}
              </li>
            ))}
          </ul>
          <select data-transfer-to value={to} onChange={(e) => setTo(e.target.value)} style={input}>
            {transfer.to.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {!transfer.to.length && <span style={{ fontSize: 13, color: COLORS.danger }}>Nobody else can take orders. Add someone first.</span>}
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button type="button" onClick={onClose} style={button()}>
          Cancel
        </button>
        <button type="button" data-disable-confirm disabled={busy || (!!transfer && !to)} onClick={() => onDisable(transfer ? to : null)} style={button("bad")}>
          <Power size={15} /> {transfer ? "Move the orders and disable" : "Disable"}
        </button>
      </div>
    </Modal>
  );
}

// The recovery code on paper or in a file — made here in the browser, so it
// never goes back to the server.
const recoveryNote = () =>
  `Made ${new Date().toLocaleString("en-GB")}. It works once: on the email sign-in, choose "Use a recovery code" and enter an Administrator's email and this code. Making a new code on Settings › Staff stops this one working.`;

function printRecoveryCode(code: string) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  if (!doc || !frame.contentWindow) return void frame.remove();
  doc.open();
  doc.write("<!doctype html><title>Recovery code</title><body style=\"font-family:system-ui,sans-serif;padding:40px\"><h1 style=\"font-size:20px\">RingzPOS recovery code</h1><p style=\"font:700 28px monospace;letter-spacing:.08em\"></p><p style=\"font-size:13px;max-width:520px;line-height:1.5\"></p></body>");
  doc.close();
  const [value, note] = Array.from(doc.querySelectorAll("p"));
  value.textContent = code;
  note.textContent = recoveryNote();
  frame.contentWindow.focus();
  frame.contentWindow.print();
  setTimeout(() => frame.remove(), 1000);
}

function downloadRecoveryCode(code: string) {
  const text = ["RingzPOS recovery code", "", code, "", recoveryNote(), ""].join(String.fromCharCode(13, 10));
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "ringzpos-recovery-code.txt";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// A staff card (Part 6f Step 7d): hold it to the reader (it types into the
// box and presses Enter) or type its number. The number is never shown again
// — only its last characters.
function CardDialog({ row, busy, onClose, onSave, onRemove }: { row: StaffRow; busy: boolean; onClose: () => void; onSave: (code: string) => void; onRemove: () => void }) {
  const [code, setCode] = useState("");
  return (
    <Modal title={`${row.firstName}'s staff card`} onClose={onClose} data="card">
      <p style={{ margin: 0, fontSize: 13.5, color: COLORS.slate, lineHeight: 1.5 }}>
        {row.card ? `Card ${row.card} signs ${row.firstName} in now. A new one replaces it.` : `Hold ${row.firstName}'s card or badge to the reader — or type its number. It then signs them in instead of their PIN, wherever a PIN does.`}
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (code.trim()) onSave(code);
        }}
        style={{ display: "flex", flexDirection: "column", gap: 12 }}
      >
        <label style={label}>
          Card number
          <input data-card-code autoFocus value={code} maxLength={64} autoComplete="off" placeholder="Hold the card to the reader" onChange={(event) => setCode(event.target.value)} style={{ ...input, fontFamily: FONTS.mono, letterSpacing: ".05em" }} />
        </label>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          {row.card ? (
            <button type="button" data-card-remove disabled={busy} onClick={onRemove} style={button("bad")}>
              Take the card away
            </button>
          ) : (
            <span />
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={onClose} style={button()}>
              Cancel
            </button>
            <button type="submit" data-card-save disabled={busy || !code.trim()} style={button("go")}>
              <CreditCard size={16} /> Save card
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
