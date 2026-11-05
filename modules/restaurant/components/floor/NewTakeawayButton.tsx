"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { useToggleState } from "@/components/layout/hooks";
import { COLORS } from "@/components/layout/theme";
import { newTakeaway } from "../../server/actions/floor";

// The floor plan's header button: a takeaway order (no table) from the shown
// area's warehouse, then straight to it.
export default function NewTakeawayButton({ areaId, disabledReason }: { areaId: string | null; disabledReason: string | null }) {
  const router = useRouter();
  const hover = useToggleState();
  const [isPending, startTransition] = useTransition();
  const disabled = !!disabledReason || isPending;

  function create() {
    if (disabled || !areaId) return;
    startTransition(async () => {
      const result = await newTakeaway(areaId);
      if (result.ok) router.push(`/restaurant/orders/${result.orderId}`);
      else toast.error(result.error);
    });
  }

  return (
    <button
      type="button"
      onClick={create}
      disabled={disabled}
      title={disabledReason ?? undefined}
      onMouseEnter={hover.on}
      onMouseLeave={hover.off}
      style={{
        height: 36,
        padding: "0 14px",
        background: hover.value && !disabled ? COLORS.tealTint : "#fff",
        border: `1px solid ${COLORS.borderStrong}`,
        borderRadius: 8,
        fontSize: 13.5,
        fontWeight: 600,
        color: COLORS.tealDark,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabledReason ? 0.55 : 1,
      }}
    >
      {isPending ? "Opening…" : "New takeaway"}
    </button>
  );
}
