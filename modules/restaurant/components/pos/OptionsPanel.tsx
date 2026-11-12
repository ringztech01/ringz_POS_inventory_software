"use client";

import { useEffect, useState, type MutableRefObject } from "react";
import { isSingleChoice, optionSteps, pickedIn, shortPrice, stepReady, toggleOption, type FlowGroup } from "../../lib/optionFlow";
import { TOUCH } from "../../lib/theme";
import { CancelKey, doneKey, footerKey, panelStyle } from "./PanelFrame";
import TouchButton from "./TouchButton";

// "Required · pick 1", "Required · pick 2 to 3", "Optional · pick any",
// "Optional · up to 2".
export function groupRule(group: FlowGroup): string {
  if (group.minSelect >= 1) {
    if (group.minSelect === group.maxSelect) return `Required · pick ${group.minSelect}`;
    return `Required · pick ${group.minSelect} to ${group.maxSelect}`;
  }
  return group.maxSelect >= group.options.length ? "Optional · pick any" : group.maxSelect === 1 ? "Optional · pick 1" : `Optional · up to ${group.maxSelect}`;
}

function Options({ group, selected, color, onTap }: { group: FlowGroup; selected: string[]; color: string; onTap: (optionId: string) => void }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gridAutoRows: "minmax(64px, 96px)", gap: TOUCH.gap, alignContent: "start" }}>
      {group.options.map((option) => {
        const on = selected.includes(option.id);
        return (
          <TouchButton
            key={option.id}
            data-option={option.name}
            aria-pressed={on}
            background={on ? TOUCH.amber : TOUCH.key}
            color={on ? TOUCH.amberInk : "#fff"}
            pressedBackground={on ? undefined : TOUCH.keyDown}
            onClick={() => onTap(option.id)}
            style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", justifyContent: "space-between", padding: "10px 12px", textAlign: "left", boxShadow: on ? "none" : `inset 0 -4px 0 ${color}` }}
          >
            <span style={{ fontSize: 17, fontWeight: 700, lineHeight: 1.15, overflowWrap: "anywhere" }}>{option.name}</span>
            <span style={{ fontFamily: TOUCH.mono, fontSize: 14, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{option.price ? shortPrice(option.price) : "No charge"}</span>
          </TouchButton>
        );
      })}
    </div>
  );
}

// A dish's options in the grid's place (the Restaurant POS design): the
// required groups one step at a time — one choice: a tap picks it and moves
// on; several: tap them, then Done — then one last step with the optional
// groups (Skip until something's picked). The trail on top numbers each step
// with what was picked (teal once answered, amber for this one). Previous
// (or Back on the crumb bar) goes a step back; Cancel drops it all.
export default function OptionsPanel({
  title,
  price,
  groups,
  color,
  initial,
  finishLabel,
  onFinish,
  onCancel,
  backRef,
}: {
  title: string;
  price: string;
  groups: FlowGroup[];
  color: string;
  initial: string[];
  // "Done" for a new dish, "Save" when changing a line's options.
  finishLabel: string;
  onFinish: (modifierIds: string[]) => void;
  onCancel: () => void;
  // Set to this panel's Back: a step back, or out at the first step.
  backRef?: MutableRefObject<(() => void) | null>;
}) {
  const steps = optionSteps(groups);
  const [at, setAt] = useState(0);
  const [selected, setSelected] = useState<string[]>(initial);
  const step = steps[Math.min(at, steps.length - 1)];
  const last = at >= steps.length - 1;
  const previous = () => (at > 0 ? setAt(at - 1) : onCancel());

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  useEffect(() => {
    if (!backRef) return;
    backRef.current = () => (at > 0 ? setAt(at - 1) : onCancel());
    return () => {
      backRef.current = null;
    };
  }, [backRef, at, onCancel]);

  function next(picked: string[]) {
    if (last) onFinish(picked);
    else setAt(at + 1);
  }

  function tap(group: FlowGroup, optionId: string) {
    const picked = toggleOption(selected, group, optionId);
    setSelected(picked);
    // One choice in a required step: picked, so on to the next step.
    if (step.kind === "pick" && isSingleChoice(group)) next(picked);
  }

  const extrasPicked = step.kind === "extras" && step.groups.some((g) => pickedIn(selected, g) > 0);
  const chosen = (group: FlowGroup) => group.options.filter((o) => selected.includes(o.id)).map((o) => o.name).join(", ");
  const showDone = step.kind === "extras" ? extrasPicked : !isSingleChoice(step.group) || (stepReady(step, selected) && initial.length > 0);
  const stepGroups = step.kind === "pick" ? [step.group] : step.groups;

  return (
    <div role="dialog" aria-label={`${title} options`} data-options-panel data-pos-panel style={{ ...panelStyle, gap: 8 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexShrink: 0 }}>
        <span style={{ fontFamily: TOUCH.display, fontSize: 22, fontWeight: 700, color: TOUCH.text, overflowWrap: "anywhere" }}>{title}</span>
        <span style={{ fontFamily: TOUCH.display, fontSize: 22, fontWeight: 700, color: TOUCH.amber, whiteSpace: "nowrap" }}>{shortPrice(price)}</span>
      </div>
      <nav aria-label="Steps" data-option-steps style={{ display: "flex", flexWrap: "wrap", gap: 6, flexShrink: 0 }}>
        {steps.map((s, i) => {
          const name = s.kind === "pick" ? s.group.name : s.groups.length === 1 ? s.groups[0].name : "Extras";
          const picks = s.kind === "pick" ? chosen(s.group) : s.groups.map(chosen).filter(Boolean).join(", ");
          const answered = i < at || (i !== at && !!picks);
          return (
            <span
              key={`${name}-${i}`}
              data-step={name}
              aria-current={i === at ? "step" : undefined}
              style={{
                height: 30,
                display: "flex",
                alignItems: "center",
                padding: "0 10px",
                borderRadius: 3,
                fontSize: 13,
                fontWeight: 600,
                background: i === at ? TOUCH.amber : answered ? TOUCH.doneBg : TOUCH.key,
                color: i === at ? TOUCH.amberInk : answered ? TOUCH.doneInk : TOUCH.textDim,
              }}
            >
              {i + 1}. {name}
              {picks ? `: ${picks}` : ""}
            </span>
          );
        })}
      </nav>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
        {stepGroups.map((group) => (
          <div key={group.id} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div data-step-title style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 4 }}>
              <span style={{ fontSize: 18, fontWeight: 700, color: TOUCH.text }}>{group.name}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: TOUCH.textDim }}>{groupRule(group)}</span>
            </div>
            <Options group={group} selected={selected} color={color} onTap={(id) => tap(group, id)} />
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: TOUCH.gap, flexShrink: 0 }}>
        <CancelKey onCancel={onCancel} />
        <TouchButton data-option-previous background={TOUCH.key} onClick={previous} style={{ ...footerKey, padding: "0 22px" }}>
          Previous
        </TouchButton>
        <div style={{ flex: 1 }} />
        {step.kind === "extras" && !extrasPicked && (
          <TouchButton data-skip background={TOUCH.key} onClick={() => onFinish(selected.filter((id) => !step.groups.some((g) => g.options.some((o) => o.id === id))))} style={footerKey}>
            Skip
          </TouchButton>
        )}
        {showDone && (
          <TouchButton data-done background={TOUCH.teal} disabled={!stepReady(step, selected)} onClick={() => next(selected)} style={{ ...doneKey, opacity: stepReady(step, selected) ? 1 : 0.4 }}>
            {last ? finishLabel : "Next"}
          </TouchButton>
        )}
      </div>
    </div>
  );
}
