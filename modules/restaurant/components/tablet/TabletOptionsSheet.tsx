"use client";

import { useState } from "react";
import { isSingleChoice, pickedIn, shortPrice, stepHint, stepReady, toggleOption, type FlowGroup } from "../../lib/optionFlow";
import { naira, priceOf, tabletSteps } from "../../lib/tabletOrder";
import { T } from "./tabletTheme";

// A dish's options on the tablet (Part 6g Step 5; design: the options
// sheet): its name and running price, a chip per step, then the step's
// options as 104 px buttons two across. Required groups come first, in
// order; a one-choice group moves on at the tap; an optional one has SKIP
// (nothing picked) and DONE. CANCEL drops it, ‹ BACK goes a step back. The
// picks follow the POS's own rules (lib/optionFlow); the running price is a
// guide — the server prices the line.

export default function TabletOptionsSheet({ name, price, groups, onAdd, onCancel }: { name: string; price: string; groups: FlowGroup[]; onAdd: (modifierIds: string[]) => void; onCancel: () => void }) {
  const steps = tabletSteps(groups);
  const [at, setAt] = useState(0);
  const [picked, setPicked] = useState<string[]>([]);
  const group = steps[at];
  const running = priceOf(price) + groups.flatMap((g) => g.options).filter((o) => picked.includes(o.id)).reduce((sum, o) => sum + priceOf(o.price), 0);
  const required = group.minSelect >= 1;
  const count = pickedIn(picked, group);

  const next = (selection: string[]) => {
    if (at + 1 >= steps.length) return onAdd(selection);
    setAt(at + 1);
  };
  const tap = (optionId: string) => {
    const selection = toggleOption(picked, group, optionId);
    setPicked(selection);
    // One choice (pick exactly one): that's the step done.
    if (isSingleChoice(group) && required) next(selection);
  };
  const clearStep = () => setPicked(picked.filter((id) => !group.options.some((o) => o.id === id)));

  const button = (label: string, onClick: () => void, background: string, color: string = T.text, data?: string, padding = "0 28px") => (
    <button type="button" className="tb-press" data-option-action={data ?? label} onClick={onClick} style={{ height: 84, padding, border: "none", borderRadius: 8, background, color, fontSize: 21, fontWeight: 900, fontFamily: "inherit", cursor: "pointer" }}>
      {label}
    </button>
  );

  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 30, background: "rgba(0,0,0,.7)", display: "flex", alignItems: "flex-end" }}>
      <div role="dialog" aria-modal="true" data-options-sheet={name} style={{ width: "100%", maxHeight: "94%", overflowY: "auto", background: T.raised, borderRadius: "18px 18px 0 0", padding: "26px 20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
          <span style={{ fontSize: 32, fontWeight: 900 }}>{name}</span>
          <span data-options-price style={{ fontSize: 30, fontWeight: 900, color: "#FFD15C" }}>
            {naira(running)}
          </span>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {steps.map((g, i) => {
            const chosen = g.options.filter((o) => picked.includes(o.id)).map((o) => o.name);
            const now = i === at;
            return (
              <span key={g.id} data-option-step={g.name} data-now={now ? "" : undefined} style={{ height: 38, display: "flex", alignItems: "center", padding: "0 14px", borderRadius: 19, background: now ? "#FFD15C" : i < at ? T.teal : T.edge, color: now ? "#000" : T.text, fontSize: 16, fontWeight: 800 }}>
                {g.name}
                {chosen.length ? `: ${chosen.join(", ")}` : ""}
              </span>
            );
          })}
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginTop: 4 }}>
          <span style={{ fontSize: 28, fontWeight: 900 }}>{group.name}</span>
          <span data-option-rule style={{ fontSize: 18, fontWeight: 700, color: T.quiet }}>
            {required ? (group.maxSelect === 1 ? "Pick 1" : stepHint(group)) : group.maxSelect === 1 ? "Optional · pick 1" : `Optional · up to ${group.maxSelect}`}
          </span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gridAutoRows: 104, gap: 10 }}>
          {group.options.map((o) => {
            const on = picked.includes(o.id);
            return (
              <button
                key={o.id}
                type="button"
                className="tb-press"
                data-option={o.name}
                aria-pressed={on}
                onClick={() => tap(o.id)}
                style={{ border: "none", borderRadius: 10, background: on ? "#FFD15C" : T.edge, color: on ? "#000" : T.text, padding: "0 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}
              >
                <span style={{ fontSize: 24, fontWeight: 800 }}>{o.name}</span>
                <span style={{ fontSize: 19, fontWeight: 700 }}>{o.price ? shortPrice(o.price) : ""}</span>
              </button>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
          {button("CANCEL", onCancel, "#000", T.lockFg, "cancel")}
          {button("‹ BACK", () => (at === 0 ? onCancel() : setAt(at - 1)), T.edge, T.text, "back")}
          <div style={{ flex: 1 }} />
          {!required && count === 0 && button("SKIP", () => (clearStep(), next(picked.filter((id) => !group.options.some((o) => o.id === id)))), T.edge, T.text, "skip", "0 40px")}
          {(!required ? count > 0 : !isSingleChoice(group) && stepReady({ kind: "pick", group }, picked)) && button(!required || at + 1 >= steps.length ? "DONE" : "NEXT", () => next(picked), T.teal, T.text, "done", "0 48px")}
        </div>
      </div>
    </div>
  );
}
