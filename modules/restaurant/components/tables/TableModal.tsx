"use client";

import { useState, useTransition, type FormEvent } from "react";
import toast from "react-hot-toast";
import { RefreshCw } from "lucide-react";
import { useToggleState } from "@/components/layout/hooks";
import { COLORS } from "@/components/layout/theme";
import MasterDataModal from "@/components/ui/MasterDataModal";
import ConfirmDeleteModal from "@/components/ui/ConfirmDeleteModal";
import { Field, SelectInput } from "@/components/purchases/form-fields";
import { MAX_SEATS, TABLE_NAME_MAX, type TableField } from "../../schemas/table";
import { createTable, regenerateTableQr, updateTable } from "../../server/actions/tables";
import TextInput from "../TextInput";

export type EditableTable = { id: string; name: string; seats: number; areaId: string };
export type AreaOption = { id: string; name: string; warehouseName: string };

function RegenerateButton({ onClick }: { onClick: () => void }) {
  const hover = useToggleState();
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={hover.on}
      onMouseLeave={hover.off}
      style={{
        height: 34,
        padding: "0 12px",
        display: "flex",
        alignItems: "center",
        gap: 6,
        background: hover.value ? COLORS.bgApp : "#fff",
        border: `1px solid ${COLORS.borderStrong}`,
        borderRadius: 8,
        fontSize: 12.5,
        fontWeight: 600,
        color: COLORS.slate,
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      <RefreshCw size={13} strokeWidth={1.8} />
      Regenerate
    </button>
  );
}

// Add / edit a table in the shared modal shell. The server validates, checks
// the name is unique in the area and makes the QR token. On edit, the QR
// code can be regenerated (the printed one stops working).
export default function TableModal({
  table,
  areas,
  defaultAreaId,
  onClose,
}: {
  table: EditableTable | null;
  areas: AreaOption[];
  defaultAreaId?: string;
  onClose: () => void;
}) {
  const [name, setName] = useState(table?.name ?? "");
  const [seats, setSeats] = useState(table ? String(table.seats) : "");
  const [areaId, setAreaId] = useState(() => {
    const current = table?.areaId ?? defaultAreaId ?? (areas.length === 1 ? areas[0].id : "");
    return areas.some((area) => area.id === current) ? current : "";
  });
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<TableField, string[]>>>({});
  const [isPending, startTransition] = useTransition();
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const [isRegenerating, startRegenerate] = useTransition();

  // Two areas with one name (in different warehouses) need the warehouse.
  const options = areas.map((area) => ({
    value: area.id,
    label: areas.filter((other) => other.name === area.name).length > 1 ? `${area.name} · ${area.warehouseName}` : area.name,
  }));

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending) return;
    setFieldErrors({});
    startTransition(async () => {
      // A non-number goes as typed; the server rejects it with the seats message.
      const input = { name, seats: /^\d+$/.test(seats) ? Number(seats) : seats, areaId };
      const result = table ? await updateTable(table.id, input) : await createTable(input);
      if (result.ok) {
        toast.success(table ? "Table updated." : "Table added.");
        onClose();
      } else {
        setFieldErrors(result.fieldErrors ?? {});
        toast.error(result.error);
      }
    });
  }

  function regenerate() {
    if (!table) return;
    startRegenerate(async () => {
      const result = await regenerateTableQr(table.id);
      setConfirmRegenerate(false);
      if (result.ok) {
        toast.success(`New QR code for ${table.name}. Print it to replace the old one.`);
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <>
      <MasterDataModal
        title={table ? `Edit table ${table.name}` : "Add table"}
        onClose={onClose}
        onSubmit={handleSubmit}
        submitting={isPending}
        submitLabel={table ? "Save" : "Add table"}
      >
        <Field label="Name" required error={fieldErrors.name?.[0]}>
          <TextInput
            value={name}
            onChange={setName}
            placeholder="e.g. T4"
            maxLength={TABLE_NAME_MAX}
            hasError={!!fieldErrors.name}
            ariaLabel="Name"
            autoFocus
          />
        </Field>
        <Field label="Seats" required error={fieldErrors.seats?.[0]}>
          <TextInput
            value={seats}
            onChange={(value) => setSeats(value.replace(/\D/g, "").slice(0, 2))}
            placeholder={`1–${MAX_SEATS}`}
            hasError={!!fieldErrors.seats}
            ariaLabel="Seats"
            inputMode="numeric"
          />
        </Field>
        <Field label="Area" required error={fieldErrors.areaId?.[0]}>
          <SelectInput
            value={areaId}
            onChange={setAreaId}
            options={options}
            placeholder="Choose area"
            hasError={!!fieldErrors.areaId}
          />
        </Field>

        {table && (
          <div style={{ display: "flex", alignItems: "center", gap: 12, paddingTop: 16, borderTop: `1px solid ${COLORS.border}` }}>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: COLORS.text }}>QR code</span>
              <span style={{ fontSize: 12.5, color: COLORS.slateMid }}>
                A new code replaces the printed one, which stops working.
              </span>
            </div>
            <RegenerateButton onClick={() => setConfirmRegenerate(true)} />
          </div>
        )}
      </MasterDataModal>

      {confirmRegenerate && table && (
        <ConfirmDeleteModal
          title="Regenerate QR code?"
          message={`${table.name}'s printed QR code will stop working straight away. You'll need to print the new one.`}
          onCancel={() => setConfirmRegenerate(false)}
          onConfirm={regenerate}
          pending={isRegenerating}
          confirmLabel="Regenerate"
          pendingLabel="Regenerating…"
          tone="primary"
        />
      )}
    </>
  );
}
