"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { ArrowDown, ArrowUp, ChevronDown, Pencil, Trash2 } from "lucide-react";
import { useToggleState } from "@/components/layout/hooks";
import { COLORS, FONTS } from "@/components/layout/theme";
import ConfirmDeleteModal from "@/components/ui/ConfirmDeleteModal";
import IconActionButton from "@/components/ui/IconActionButton";
import ReportTable, { type ReportColumn } from "@/components/reports/ReportTable";
import { groupRuleLabel, groupType, priceChangeLabel } from "../../lib/modifiers";
import { R } from "../../lib/theme";
import { deleteModifier, moveModifier } from "../../server/actions/modifiers";
import type { ModifierGroupOption, ModifierRow } from "../../server/queries/modifierList";
import ModifierOptionModal from "./ModifierOptionModal";

// Food › Modifiers › Modifiers: pick a group (?group=), see its modifiers in
// rank order with their price change; ↑ / ↓ re-rank them (the order on the
// order screen), plus add / edit / delete.

function AddButton({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  const hover = useToggleState();
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={hover.on}
      onMouseLeave={hover.off}
      style={{ height: 38, padding: "0 14px", background: disabled ? COLORS.slateLight : hover.value ? COLORS.tealDark : COLORS.teal, border: "none", borderRadius: 8, color: "#fff", fontSize: 13.5, fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer", whiteSpace: "nowrap" }}
    >
      + Add modifier
    </button>
  );
}

export default function ModifiersPanel({ groups, groupId, rows }: { groups: ModifierGroupOption[]; groupId: string | null; rows: ModifierRow[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const [editing, setEditing] = useState<ModifierRow | "new" | null>(null);
  const [deleting, setDeleting] = useState<ModifierRow | null>(null);
  const [isDeleting, startDelete] = useTransition();
  const [isMoving, startMove] = useTransition();
  const group = groups.find((g) => g.id === groupId) ?? null;

  function pickGroup(id: string) {
    router.replace(`${pathname}?view=options&group=${id}`, { scroll: false });
  }

  function move(row: ModifierRow, direction: "up" | "down") {
    startMove(async () => {
      const result = await moveModifier({ id: row.id, direction });
      if (!result.ok) toast.error(result.error);
      router.refresh();
    });
  }

  function askDelete(row: ModifierRow) {
    if (row.deleteBlocker) toast.error(row.deleteBlocker);
    else setDeleting(row);
  }

  function confirmDelete() {
    if (!deleting) return;
    startDelete(async () => {
      const result = await deleteModifier(deleting.id);
      setDeleting(null);
      if (result.ok) toast.success(`${deleting.name} deleted.`);
      else toast.error(result.error);
    });
  }

  const columns: ReportColumn<ModifierRow>[] = [
    {
      label: "Rank",
      width: "120px",
      render: (row) => (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span data-rank style={{ fontFamily: FONTS.mono, width: 22, color: COLORS.slate }}>{row.rank}</span>
          <IconActionButton icon={<ArrowUp size={13} strokeWidth={1.8} />} title={`Move ${row.name} up`} size={26} disabled={isMoving || row.rank === 1} onClick={() => move(row, "up")} />
          <IconActionButton icon={<ArrowDown size={13} strokeWidth={1.8} />} title={`Move ${row.name} down`} size={26} disabled={isMoving || row.rank === rows.length} onClick={() => move(row, "down")} />
        </span>
      ),
    },
    { label: "Name", width: "minmax(180px,2fr)", render: (row) => <span style={{ fontWeight: 600 }}>{row.name}</span> },
    {
      label: "Price change",
      width: "minmax(120px,1fr)",
      align: "right",
      render: (row) => <span style={{ fontFamily: FONTS.mono, color: Number(row.price) === 0 ? COLORS.slateMid : COLORS.ink }}>{priceChangeLabel(row.price)}</span>,
    },
    {
      label: "Actions",
      width: "80px",
      align: "right",
      render: (row) => (
        <span style={{ display: "inline-flex", gap: 6 }}>
          <IconActionButton icon={<Pencil size={13} strokeWidth={1.8} />} title={`Edit ${row.name}`} size={28} onClick={() => setEditing(row)} />
          <IconActionButton
            icon={<Trash2 size={13} strokeWidth={1.8} />}
            title={row.deleteBlocker ?? `Delete ${row.name}`}
            tone="danger"
            baseColor={row.deleteBlocker ? COLORS.slateLight : undefined}
            size={28}
            onClick={() => askDelete(row)}
          />
        </span>
      ),
    },
  ];

  return (
    <section aria-label="Modifiers" style={{ background: "#fff", border: `1px solid ${COLORS.border}`, borderRadius: 12, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontFamily: FONTS.display, fontSize: 19, fontWeight: 600 }}>Modifiers in</h2>
        {groups.length > 0 && (
          <div style={{ position: "relative" }}>
            <select
              aria-label="Group"
              value={groupId ?? ""}
              onChange={(event) => pickGroup(event.target.value)}
              style={{ appearance: "none", height: 38, minWidth: 200, border: `1px solid ${COLORS.borderStrong}`, borderRadius: 8, padding: "0 30px 0 10px", fontSize: 13.5, fontWeight: 600, background: "#fff", cursor: "pointer", outline: "none" }}
            >
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
            <ChevronDown size={13} strokeWidth={1.8} color={COLORS.slateMid} style={{ position: "absolute", right: 10, top: 13, pointerEvents: "none" }} />
          </div>
        )}
        {group && (
          <span data-group-rule style={{ fontSize: 12.5, color: COLORS.slateMid }}>
            {groupType(group.rule.maxSelect)} · {groupRuleLabel(group.rule.minSelect, group.rule.maxSelect)}
          </span>
        )}
        <span style={{ marginLeft: "auto" }}>
          <AddButton onClick={() => setEditing("new")} disabled={!group} />
        </span>
      </div>

      {groups.length === 0 ? (
        <p data-empty style={{ margin: 0, padding: "18px", borderTop: `1px solid ${R.rowBorder}`, fontSize: 13.5, color: COLORS.slateMid }}>
          No modifier groups yet. <Link href="/restaurant/food/modifiers">Add a group</Link> first — modifiers belong to a group.
        </p>
      ) : (
        <ReportTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          minWidth={560}
          rowHeight={50}
          flush
          emptyMessage={`No modifiers in ${group?.name ?? "this group"} yet. Add one — e.g. Regular, Large (+₦2).`}
        />
      )}
      <div style={{ padding: "12px 18px", borderTop: `1px solid ${R.rowBorder}`, fontSize: 12.5, color: COLORS.slateMid }}>
        The order screen lists them in this order. Orders already taken keep the options and prices they had.
      </div>

      {editing && group && <ModifierOptionModal modifier={editing === "new" ? null : editing} groupId={group.id} groups={groups} onClose={() => setEditing(null)} />}
      {deleting && (
        <ConfirmDeleteModal
          title="Delete modifier"
          message={`Delete "${deleting.name}" from ${group?.name ?? "its group"}? It stops being offered; orders already taken keep it.`}
          onCancel={() => setDeleting(null)}
          onConfirm={confirmDelete}
          pending={isDeleting}
        />
      )}
    </section>
  );
}
