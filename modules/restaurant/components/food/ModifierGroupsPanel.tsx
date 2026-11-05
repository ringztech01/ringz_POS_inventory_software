"use client";

import { Suspense, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import toast from "react-hot-toast";
import { ChevronDown, Pencil, Trash2 } from "lucide-react";
import { useToggleState } from "@/components/layout/hooks";
import { COLORS, FONTS } from "@/components/layout/theme";
import ConfirmDeleteModal from "@/components/ui/ConfirmDeleteModal";
import IconActionButton from "@/components/ui/IconActionButton";
import Pagination from "@/components/ui/Pagination";
import SearchInput from "@/components/ui/SearchInput";
import ReportTable, { type ReportColumn } from "@/components/reports/ReportTable";
import { R } from "../../lib/theme";
import { deleteModifierGroup } from "../../server/actions/modifierGroups";
import type { GroupFilter, ModifierGroupRow } from "../../server/queries/modifierGroups";
import ModifierGroupModal from "./ModifierGroupModal";

// Food › Modifiers › Groups: the shared modifier groups (one group belongs
// to many menu items) with their rules, how many items use them and how
// many modifiers they have. Search (?q) and Required / Optional (?required)
// live in the URL, as does the page.

function RequiredFilter({ value }: { value: GroupFilter }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  function change(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (next) params.set("required", next);
    else params.delete("required");
    params.delete("page");
    router.push(`${pathname}?${params.toString()}`);
  }
  return (
    <div style={{ position: "relative" }}>
      <select
        aria-label="Required"
        value={value ?? ""}
        onChange={(event) => change(event.target.value)}
        style={{ appearance: "none", height: 38, border: `1px solid ${COLORS.borderStrong}`, borderRadius: 8, padding: "0 30px 0 10px", fontSize: 13.5, background: "#fff", cursor: "pointer", outline: "none" }}
      >
        <option value="">Required and optional</option>
        <option value="required">Required only</option>
        <option value="optional">Optional only</option>
      </select>
      <ChevronDown size={13} strokeWidth={1.8} color={COLORS.slateMid} style={{ position: "absolute", right: 10, top: 13, pointerEvents: "none" }} />
    </div>
  );
}

function AddButton({ onClick }: { onClick: () => void }) {
  const hover = useToggleState();
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={hover.on}
      onMouseLeave={hover.off}
      style={{ height: 38, padding: "0 14px", background: hover.value ? COLORS.tealDark : COLORS.teal, border: "none", borderRadius: 8, color: "#fff", fontSize: 13.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}
    >
      + Add group
    </button>
  );
}

export default function ModifierGroupsPanel({
  rows,
  filter,
  filtered,
  page,
  perPage,
  total,
  totalPages,
}: {
  rows: ModifierGroupRow[];
  filter: GroupFilter;
  filtered: boolean;
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
}) {
  const [editing, setEditing] = useState<ModifierGroupRow | "new" | null>(null);
  const [deleting, setDeleting] = useState<ModifierGroupRow | null>(null);
  const [isDeleting, startDelete] = useTransition();

  function askDelete(row: ModifierGroupRow) {
    if (row.deleteBlocker) toast.error(row.deleteBlocker);
    else setDeleting(row);
  }

  function confirmDelete() {
    if (!deleting) return;
    startDelete(async () => {
      const result = await deleteModifierGroup(deleting.id);
      setDeleting(null);
      if (result.ok) toast.success(`${deleting.name} deleted.`);
      else toast.error(result.error);
    });
  }

  const columns: ReportColumn<ModifierGroupRow>[] = [
    { label: "Name", width: "minmax(160px,2fr)", render: (row) => <span style={{ fontWeight: 600 }}>{row.name}</span> },
    {
      label: "Type",
      width: "minmax(150px,1.4fr)",
      render: (row) => (
        <span style={{ display: "flex", flexDirection: "column" }}>
          <span>{row.type}</span>
          <span style={{ fontSize: 12, color: COLORS.slateMid }}>{row.rule}</span>
        </span>
      ),
    },
    { label: "Min", width: "60px", align: "right", render: (row) => <span style={{ fontFamily: FONTS.mono }}>{row.minSelect}</span> },
    { label: "Max", width: "60px", align: "right", render: (row) => <span style={{ fontFamily: FONTS.mono }}>{row.maxSelect}</span> },
    {
      label: "Required",
      width: "100px",
      render: (row) => (
        <span
          style={{
            height: 22,
            padding: "0 9px",
            borderRadius: 11,
            display: "inline-flex",
            alignItems: "center",
            fontSize: 11.5,
            fontWeight: 600,
            background: row.required ? COLORS.tealTint : COLORS.bgApp,
            color: row.required ? COLORS.tealDark : COLORS.slateMid,
          }}
        >
          {row.required ? "Required" : "Optional"}
        </span>
      ),
    },
    { label: "Modifiers", width: "90px", align: "right", render: (row) => <span style={{ fontFamily: FONTS.mono }}>{row.modifiers}</span> },
    { label: "Items", width: "70px", align: "right", render: (row) => <span style={{ fontFamily: FONTS.mono }}>{row.items}</span> },
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
    <section aria-label="Modifier groups" style={{ background: "#fff", border: `1px solid ${COLORS.border}`, borderRadius: 12, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px" }}>
        <h2 style={{ margin: 0, fontFamily: FONTS.display, fontSize: 19, fontWeight: 600 }}>Modifier groups</h2>
        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          <Suspense fallback={null}>
            <RequiredFilter value={filter} />
            <SearchInput placeholder="Search groups" width={220} height={38} />
          </Suspense>
          <AddButton onClick={() => setEditing("new")} />
        </span>
      </div>
      <ReportTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        minWidth={760}
        rowHeight={56}
        flush
        emptyMessage={filtered ? "No modifier groups match. Try another search or filter." : "No modifier groups yet. Add one — e.g. Portion, Extras or Spice level."}
      />
      <Suspense fallback={null}>
        <Pagination page={page} perPage={perPage} total={total} totalPages={totalPages} />
      </Suspense>
      <div style={{ padding: "12px 18px", borderTop: `1px solid ${R.rowBorder}`, fontSize: 12.5, color: COLORS.slateMid }}>
        A group is shared by every menu item it&apos;s on. Groups on a menu item can&apos;t be deleted.
      </div>

      {editing && <ModifierGroupModal group={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      {deleting && (
        <ConfirmDeleteModal
          title="Delete modifier group"
          message={`Delete "${deleting.name}"${deleting.modifiers ? ` and its ${deleting.modifiers} ${deleting.modifiers === 1 ? "modifier" : "modifiers"}` : ""}? Orders already taken keep the options they had.`}
          onCancel={() => setDeleting(null)}
          onConfirm={confirmDelete}
          pending={isDeleting}
        />
      )}
    </section>
  );
}
