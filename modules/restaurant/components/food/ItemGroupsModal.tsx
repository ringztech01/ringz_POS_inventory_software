"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { X } from "lucide-react";
import { COLORS, FONTS } from "@/components/layout/theme";
import { groupRuleLabel } from "../../lib/modifiers";
import { R } from "../../lib/theme";
import { setMenuItemGroup } from "../../server/actions/menuItems";
import type { MenuItemRow } from "../../server/queries/menuItems";
import type { ModifierGroupOption } from "../../server/queries/modifierList";

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

// Food › Menu items › Modifiers: every modifier group with a switch to put
// it on or take it off this item — each switch saves straight away. Shows
// how many modifiers a group has and its rule ("Pick 1–2").
export default function ItemGroupsModal({ item, groups, onClose }: { item: MenuItemRow; groups: ModifierGroupOption[]; onClose: () => void }) {
  const router = useRouter();
  const [on, setOn] = useState(() => new Set(item.groupIds));
  const [saving, setSaving] = useState<Set<string>>(new Set());

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function toggle(group: ModifierGroupOption) {
    if (saving.has(group.id)) return;
    const attached = !on.has(group.id);
    const flip = (value: boolean) =>
      setOn((current) => {
        const next = new Set(current);
        if (value) next.add(group.id);
        else next.delete(group.id);
        return next;
      });
    flip(attached);
    setSaving((current) => new Set(current).add(group.id));
    try {
      const result = await setMenuItemGroup({ productId: item.id, groupId: group.id, attached });
      if (result.ok) toast.success(attached ? `${group.name} added to ${item.name}.` : `${group.name} taken off ${item.name}.`);
      else {
        flip(!attached);
        toast.error(result.error);
      }
    } catch {
      flip(!attached);
      toast.error("Couldn't reach the server — try again.");
    } finally {
      setSaving((current) => {
        const next = new Set(current);
        next.delete(group.id);
        return next;
      });
      router.refresh();
    }
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(23,27,28,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 80 }}>
      <div
        role="dialog"
        aria-label={`Modifier groups for ${item.name}`}
        onClick={(event) => event.stopPropagation()}
        style={{ width: 480, maxHeight: "80vh", background: "#fff", borderRadius: 14, padding: 22, display: "flex", flexDirection: "column", gap: 14 }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontFamily: FONTS.display, fontSize: 19, fontWeight: 600 }}>Modifiers · {item.name}</span>
          <button type="button" aria-label="Close" onClick={onClose} style={{ border: "none", background: "none", cursor: "pointer", color: COLORS.slateMid, display: "flex" }}>
            <X size={18} strokeWidth={1.8} />
          </button>
        </div>
        <p style={{ margin: 0, fontSize: 13.5, color: COLORS.slate }}>Switch on the groups guests choose from for this dish. Changes save straight away.</p>

        {groups.length === 0 ? (
          <p data-empty style={{ margin: 0, fontSize: 13.5, color: COLORS.slateMid }}>
            No modifier groups yet. <Link href="/restaurant/food/modifiers">Create one in Modifiers</Link> first.
          </p>
        ) : (
          <div style={{ overflowY: "auto", minHeight: 0 }}>
            {groups.map((group) => {
              const attached = on.has(group.id);
              return (
                <div key={group.id} data-item-group={group.name} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderTop: `1px solid ${R.rowBorder}` }}>
                  <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{group.name}</span>
                    <span style={{ fontSize: 12.5, color: COLORS.slateMid }}>
                      {group.modifiers} {group.modifiers === 1 ? "modifier" : "modifiers"}
                      {group.modifiers === 0 && " — not shown on the order screen until it has some"}
                    </span>
                  </span>
                  <span data-rule style={{ fontSize: 12.5, fontWeight: 600, color: group.rule.minSelect >= 1 ? COLORS.tealDark : COLORS.slateMid }}>
                    {capitalise(groupRuleLabel(group.rule.minSelect, group.rule.maxSelect))}
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={attached}
                    aria-label={`${group.name} on ${item.name}`}
                    disabled={saving.has(group.id)}
                    onClick={() => void toggle(group)}
                    style={{ width: 40, height: 22, border: "none", borderRadius: 11, background: attached ? COLORS.teal : "#cfd5d7", position: "relative", cursor: "pointer", padding: 0, flexShrink: 0, opacity: saving.has(group.id) ? 0.7 : 1 }}
                  >
                    <span style={{ position: "absolute", top: 3, left: attached ? 21 : 3, width: 16, height: 16, borderRadius: 8, background: "#fff", transition: "left .12s" }} />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <button
          type="button"
          onClick={onClose}
          style={{ alignSelf: "flex-end", height: 38, padding: "0 18px", border: "none", borderRadius: 8, background: COLORS.teal, color: "#fff", fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}
        >
          Done
        </button>
      </div>
    </div>
  );
}
