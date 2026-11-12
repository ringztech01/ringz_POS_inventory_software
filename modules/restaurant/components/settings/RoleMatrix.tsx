"use client";

import { useMemo, useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Copy, Lock, ShieldCheck, Users } from "lucide-react";
import { COLORS, FONTS } from "@/components/layout/theme";
import { ACCESS_INFO, ACCESS_LEVELS, HOME_INFO, HOME_SCREENS, type AccessLevel, type HomeScreen } from "../../lib/staffRoles";
import { copyRole, saveRoleMatrix } from "../../server/actions/staffRoles";
import type { MatrixRole, RoleMatrix as RoleMatrixData } from "../../server/services/staffRoles";

// Settings › Restaurant › Roles (Part 6f Step 2; Administrator only): every
// role as a column — its access level, home screen and permissions — saved
// together. Copy role makes a custom role from any one.

type Row = Pick<MatrixRole, "accessLevel" | "homeScreen" | "homeAreaId" | "homeStation"> & { permissions: string[] };
const UNREACHABLE = "Couldn't reach the server. Check the connection and try again.";
const rowOf = (r: MatrixRole): Row => ({ accessLevel: r.accessLevel, homeScreen: r.homeScreen, homeAreaId: r.homeAreaId, homeStation: r.homeStation, permissions: [...r.permissions].sort() });
const sameRow = (a: Row, b: Row) => JSON.stringify(a) === JSON.stringify(b);

export default function RoleMatrix({ data }: { data: RoleMatrixData }) {
  const router = useRouter();
  const initial = useMemo(() => Object.fromEntries(data.roles.map((r) => [r.id, rowOf(r)])), [data]);
  const [edited, setRows] = useState<Record<string, Row>>(initial);
  const [seen, setSeen] = useState(initial);
  // Fresh data from the server (after a save or a copy): take it — in this
  // very render too, since it may hold a role the old state doesn't.
  let rows = edited;
  if (seen !== initial) {
    setSeen(initial);
    setRows(initial);
    rows = initial;
  }
  const [copying, setCopying] = useState<MatrixRole | null>(null);
  const [copyName, setCopyName] = useState("");
  const [busy, startBusy] = useTransition();
  const changed = data.roles.filter((r) => rows[r.id] && !sameRow(rows[r.id], initial[r.id]));

  const set = (id: string, change: Partial<Row>) => setRows((all) => ({ ...all, [id]: { ...all[id], ...change } }));
  const toggle = (id: string, permission: string) =>
    setRows((all) => {
      const has = all[id].permissions.includes(permission);
      return { ...all, [id]: { ...all[id], permissions: (has ? all[id].permissions.filter((p) => p !== permission) : [...all[id].permissions, permission]).sort() } };
    });

  function save() {
    startBusy(async () => {
      const result = await saveRoleMatrix({ roles: changed.map((r) => ({ id: r.id, ...rows[r.id], homeStation: rows[r.id].homeScreen === "KITCHEN" ? rows[r.id].homeStation : null })) }).catch(() => ({ ok: false as const, error: UNREACHABLE }));
      if (!result.ok) return void toast.error(result.error);
      toast.success(result.changed === 1 ? "1 role saved." : `${result.changed} roles saved.`);
      router.refresh();
    });
  }
  function copy() {
    if (!copying) return;
    const from = copying;
    startBusy(async () => {
      const result = await copyRole({ fromId: from.id, name: copyName }).catch(() => ({ ok: false as const, error: UNREACHABLE }));
      if (!result.ok) return void toast.error(result.error);
      toast.success(`“${copyName.trim()}” made from ${from.name}.`);
      setCopying(null);
      router.refresh();
    });
  }

  const head: CSSProperties = { position: "sticky", left: 0, zIndex: 2, background: "#fff", minWidth: 230, maxWidth: 230, padding: "10px 16px", textAlign: "left", borderRight: `1px solid ${COLORS.border}` };
  const cell: CSSProperties = { minWidth: 168, padding: "10px 12px", borderLeft: `1px solid ${COLORS.border}`, verticalAlign: "top" };
  const select: CSSProperties = { width: "100%", height: 32, border: `1px solid ${COLORS.border}`, borderRadius: 7, padding: "0 6px", fontSize: 12.5, background: "#fff" };
  const label: CSSProperties = { fontSize: 11, fontWeight: 600, color: COLORS.slateMid, textTransform: "uppercase", letterSpacing: ".04em" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, maxWidth: 760 }}>
          <h1 style={{ margin: 0, fontFamily: FONTS.display, fontSize: 24, fontWeight: 600, letterSpacing: "-.01em" }}>Staff roles</h1>
          <p style={{ margin: 0, fontSize: 13.5, color: COLORS.slateMid, lineHeight: 1.5 }}>
            What each role can do, whether it reaches the back office, and where its people land after their PIN. The six built-in roles can&apos;t be deleted; copy one to make your own. Only an Administrator can change this page.
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span data-matrix-changed style={{ fontSize: 13, color: changed.length ? "#9A5B00" : COLORS.slateMid }}>
            {changed.length ? `${changed.length} role${changed.length === 1 ? "" : "s"} changed` : "No changes"}
          </span>
          <button
            type="button"
            data-matrix-save
            disabled={busy || !changed.length}
            onClick={save}
            style={{ height: 38, padding: "0 18px", border: "none", borderRadius: 8, background: changed.length ? COLORS.teal : COLORS.border, color: changed.length ? "#fff" : COLORS.slateMid, fontSize: 14, fontWeight: 600, cursor: changed.length ? "pointer" : "default" }}
          >
            {busy ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>

      <section style={{ background: "#fff", border: `1px solid ${COLORS.border}`, borderRadius: 12, overflow: "auto", maxHeight: "calc(100vh - 230px)" }}>
        <table data-role-matrix style={{ borderCollapse: "separate", borderSpacing: 0, fontSize: 13 }}>
          <thead style={{ position: "sticky", top: 0, zIndex: 3, background: "#fff", boxShadow: `0 1px 0 ${COLORS.border}` }}>
            <tr>
              <th style={{ ...head, zIndex: 4, verticalAlign: "bottom" }}>
                <span style={label}>Role</span>
              </th>
              {data.roles.map((role) => {
                const row = rows[role.id];
                const dirty = !sameRow(row, initial[role.id]);
                return (
                  <th key={role.id} data-role-column={role.name} style={{ ...cell, textAlign: "left", fontWeight: 400, background: dirty ? "#FFF8EC" : "#fff" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontFamily: FONTS.display, fontSize: 15, fontWeight: 700, color: COLORS.ink }}>{role.name}</span>
                        {dirty && <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#D98A00" }} aria-label="changed" />}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <span data-role-kind style={{ fontSize: 11, fontWeight: 700, color: role.systemRole ? COLORS.tealDark : COLORS.slate, background: role.systemRole ? COLORS.tealTint : COLORS.bgApp, padding: "2px 7px", borderRadius: 999 }}>
                          {role.systemRole ? "Built in" : "Custom"}
                        </span>
                        <span style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 12, color: COLORS.slateMid }}>
                          <Users size={12} /> {role.users}
                        </span>
                      </div>
                      <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                        <span style={label}>Access</span>
                        {role.isAdmin ? (
                          <span style={{ display: "flex", alignItems: "center", gap: 5, height: 32, fontSize: 12.5, fontWeight: 600, color: COLORS.ink }}>
                            <Lock size={12} /> Back office
                          </span>
                        ) : (
                          <select data-role-access value={row.accessLevel} title={ACCESS_INFO[row.accessLevel].about} onChange={(event) => set(role.id, { accessLevel: event.target.value as AccessLevel })} style={select}>
                            {ACCESS_LEVELS.map((level) => (
                              <option key={level} value={level}>
                                {ACCESS_INFO[level].label}
                              </option>
                            ))}
                          </select>
                        )}
                      </label>
                      <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                        <span style={label}>Home</span>
                        <select data-role-home value={row.homeScreen} title={HOME_INFO[row.homeScreen].about} onChange={(event) => set(role.id, { homeScreen: event.target.value as HomeScreen })} style={select}>
                          {HOME_SCREENS.map((home) => (
                            <option key={home} value={home}>
                              {HOME_INFO[home].label}
                            </option>
                          ))}
                        </select>
                        {HOME_INFO[row.homeScreen].area ? (
                          <select data-role-area aria-label="Opens on" value={row.homeAreaId ?? ""} onChange={(event) => set(role.id, { homeAreaId: event.target.value || null })} style={select}>
                            <option value="">First area</option>
                            {data.areas.map((area) => (
                              <option key={area.id} value={area.id}>
                                {area.name}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <select data-role-station aria-label="Station" value={row.homeStation ?? ""} onChange={(event) => set(role.id, { homeStation: event.target.value || null })} style={select}>
                            <option value="">All stations</option>
                            {data.stations.map((station) => (
                              <option key={station.code} value={station.code}>
                                {station.name}
                              </option>
                            ))}
                          </select>
                        )}
                      </label>
                      <button
                        type="button"
                        data-role-copy
                        onClick={() => {
                          setCopying(role);
                          setCopyName(`${role.name} copy`);
                        }}
                        style={{ height: 30, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, border: `1px solid ${COLORS.border}`, borderRadius: 7, background: "#fff", color: COLORS.slate, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}
                      >
                        <Copy size={13} /> Copy role
                      </button>
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {data.groups.map((group) => (
              <GroupRows key={group.label ?? "core"} group={group} roles={data.roles} rows={rows} toggle={toggle} head={head} cell={cell} />
            ))}
          </tbody>
        </table>
      </section>

      {copying && (
        <div role="dialog" aria-modal="true" aria-label="Copy role" data-copy-dialog onPointerDown={(event) => event.target === event.currentTarget && setCopying(null)} style={{ position: "fixed", inset: 0, zIndex: 80, background: "rgba(23,27,28,.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              copy();
            }}
            style={{ width: 420, maxWidth: "100%", background: "#fff", borderRadius: 12, padding: 22, display: "flex", flexDirection: "column", gap: 14, boxShadow: "0 16px 40px rgba(0,0,0,.25)" }}
          >
            <span style={{ fontFamily: FONTS.display, fontSize: 18, fontWeight: 700 }}>Copy {copying.name}</span>
            <span style={{ fontSize: 13, color: COLORS.slateMid, lineHeight: 1.5 }}>
              A new custom role with the same {copying.isAdmin ? "(every) " : ""}permissions, access level and home screen. You can change it after; it can be deleted.
            </span>
            <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, fontWeight: 600 }}>
              Name
              <input data-copy-name autoFocus value={copyName} maxLength={50} onChange={(event) => setCopyName(event.target.value)} style={{ height: 40, border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: "0 12px", fontSize: 14 }} />
            </label>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" onClick={() => setCopying(null)} style={{ height: 38, padding: "0 16px", border: `1px solid ${COLORS.border}`, borderRadius: 8, background: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
                Cancel
              </button>
              <button type="submit" data-copy-save disabled={busy || !copyName.trim()} style={{ height: 38, padding: "0 16px", border: "none", borderRadius: 8, background: COLORS.teal, color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
                {busy ? "Copying…" : "Make the role"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function GroupRows({
  group,
  roles,
  rows,
  toggle,
  head,
  cell,
}: {
  group: RoleMatrixData["groups"][number];
  roles: MatrixRole[];
  rows: Record<string, Row>;
  toggle: (id: string, permission: string) => void;
  head: CSSProperties;
  cell: CSSProperties;
}) {
  return (
    <>
      <tr>
        <th colSpan={roles.length + 1} style={{ ...head, maxWidth: "none", position: "sticky", left: 0, background: COLORS.bgApp, fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em", color: COLORS.slate, borderTop: `1px solid ${COLORS.border}` }}>
          {group.label ?? "Core (retail & back office)"}
        </th>
      </tr>
      {group.permissions.map((permission) => (
        <tr key={permission} data-permission-row={permission}>
          <th scope="row" style={{ ...head, fontWeight: 500, color: COLORS.ink, borderTop: `1px solid ${COLORS.border}` }}>
            {permission}
          </th>
          {roles.map((role) => {
            const on = role.isAdmin || rows[role.id].permissions.includes(permission);
            return (
              <td key={role.id} style={{ ...cell, textAlign: "center", borderTop: `1px solid ${COLORS.border}`, padding: "6px 12px" }}>
                {role.isAdmin ? (
                  <ShieldCheck size={16} color={COLORS.teal} aria-label={`${role.name}: ${permission} (always)`} />
                ) : (
                  <input type="checkbox" data-perm={`${role.name}|${permission}`} aria-label={`${role.name}: ${permission}`} checked={on} onChange={() => toggle(role.id, permission)} style={{ width: 17, height: 17, accentColor: COLORS.teal, cursor: "pointer" }} />
                )}
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}
