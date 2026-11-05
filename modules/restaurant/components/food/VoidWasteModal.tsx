"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import MasterDataModal from "@/components/ui/MasterDataModal";
import { Field } from "@/components/purchases/form-fields";
import { COLORS } from "@/components/layout/theme";
import { formatNaira } from "@/lib/format";
import { WASTE_NOTE_MAX } from "../../schemas/waste";
import { voidWaste } from "../../server/actions/waste";
import type { WasteRow } from "../../server/queries/waste";

// Void a waste entry (Approve Waste): why. The stock it took out goes back —
// exactly its saved lines — and the entry stays, marked Voided. Sends the
// version this screen showed; someone else's change first is refused.
export default function VoidWasteModal({ entry, onClose }: { entry: WasteRow; onClose: () => void }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !reason.trim()) return;
    setSaving(true);
    setError(null);
    const result = await voidWaste({ id: entry.id, reason: reason.trim(), version: entry.version });
    setSaving(false);
    if (result.ok) {
      toast.success(`Voided · ${entry.item.name} back in stock.`);
      onClose();
      return;
    }
    if ("stale" in result && result.stale) {
      toast.error(result.error);
      onClose();
      router.refresh();
      return;
    }
    setError(result.error);
  }

  return (
    <MasterDataModal title="Void waste entry" onClose={onClose} onSubmit={handleSubmit} submitting={saving} submitDisabled={!reason.trim()} submitLabel="Void entry">
      <p style={{ margin: 0, fontSize: 13.5, color: COLORS.slate }}>
        {entry.qty} {entry.unit} {entry.item.name} ({formatNaira(entry.cost)}) goes back into stock. The entry stays on the list, marked Voided.
      </p>
      <Field label="Reason" required>
        <textarea
          aria-label="Void reason"
          autoFocus
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={WASTE_NOTE_MAX}
          rows={3}
          placeholder="e.g. Logged the wrong item"
          style={{ border: `1px solid ${COLORS.borderStrong}`, borderRadius: 8, padding: "10px 12px", fontSize: 13.5, resize: "vertical", outline: "none", fontFamily: "inherit" }}
        />
      </Field>
      {error && (
        <p role="alert" style={{ margin: 0, fontSize: 13, color: COLORS.danger }}>
          {error}
        </p>
      )}
    </MasterDataModal>
  );
}
