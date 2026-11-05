"use client";

import { useOptimistic, useTransition } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { COLORS } from "@/components/layout/theme";
import { setMenuItemFlag } from "../../server/actions/menuItems";

// A menu item's Available / On menu switch (design: 40×22, teal when on).
// Saves straight away; the new position shows while saving and falls back
// to the server's value if it fails.
export default function MenuSwitch({
  id,
  name,
  field,
  value,
  disabled,
}: {
  id: string;
  name: string;
  field: "isAvailable" | "showOnMenu";
  value: boolean;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [on, setOn] = useOptimistic(value);
  const label = field === "isAvailable" ? "Available" : "On menu";

  function toggle(event: React.MouseEvent) {
    event.stopPropagation();
    if (disabled || isPending) return;
    const next = !on;
    startTransition(async () => {
      setOn(next);
      const result = await setMenuItemFlag({ id, field, value: next });
      if (result.ok) {
        toast.success(
          field === "isAvailable" ? `${name} is ${next ? "available" : "unavailable"}.` : `${name} is ${next ? "on" : "off"} the menu.`,
        );
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={`${label}: ${name}`}
      data-switch={field}
      onClick={toggle}
      disabled={disabled}
      style={{ width: 40, height: 22, border: "none", borderRadius: 11, background: on ? COLORS.teal : "#cfd5d7", position: "relative", cursor: disabled ? "not-allowed" : "pointer", padding: 0, flexShrink: 0 }}
    >
      <span style={{ position: "absolute", top: 3, left: on ? 21 : 3, width: 16, height: 16, borderRadius: 8, background: "#fff", transition: "left .12s" }} />
    </button>
  );
}
