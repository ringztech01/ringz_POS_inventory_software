"use client";

import { useOptimistic, useTransition } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { COLORS } from "@/components/layout/theme";
import { setModuleEnabled } from "@/app/(dashboard)/settings/actions";

// The on/off switch for one optional module on the Settings page.
// `canChange` false (no settings permission): shown, but disabled.
export default function ModuleSwitch({
  moduleId,
  label,
  enabled,
  canChange,
}: {
  moduleId: string;
  label: string;
  enabled: boolean;
  canChange: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // The new position shows while saving; on failure it falls back to the
  // server's value.
  const [on, setOn] = useOptimistic(enabled);

  function toggle() {
    if (!canChange || isPending) return;
    const next = !on;
    startTransition(async () => {
      setOn(next);
      const result = await setModuleEnabled(moduleId, next);
      if (result.ok) {
        toast.success(`${label} module turned ${next ? "on" : "off"}.`);
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
      aria-label={`${label} module`}
      title={canChange ? undefined : "You can't change this setting."}
      onClick={toggle}
      disabled={!canChange || isPending}
      style={{
        width: 44,
        height: 24,
        flex: "0 0 auto",
        padding: 2,
        border: "none",
        borderRadius: 999,
        background: on ? COLORS.teal : COLORS.borderStrong,
        cursor: canChange && !isPending ? "pointer" : "not-allowed",
        opacity: canChange ? 1 : 0.55,
        transition: "background .15s",
        display: "flex",
        justifyContent: on ? "flex-end" : "flex-start",
      }}
    >
      <span
        style={{
          width: 20,
          height: 20,
          borderRadius: 999,
          background: "#fff",
          boxShadow: "0 1px 2px rgba(23,27,28,.25)",
        }}
      />
    </button>
  );
}
