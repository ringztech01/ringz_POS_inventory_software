"use client";

import { useEffect, useRef, useState } from "react";
import { checkSelection } from "../../../lib/modifiers";
import { GUEST_LINE_QTY_MAX, GUEST_NOTE_MAX } from "../../../lib/guestOrdering";
import { MENU_STRINGS } from "../../../lib/menuStrings";
import type { MenuStatus, PublicMenuItem, PublicModifierGroup } from "../../../lib/publicMenu";
import { missingGroups, toggleOption } from "../../../lib/showcaseMenu";
import { menuMoney } from "../menuMoney";
import ShowcaseStage, { type StageMode } from "./ShowcaseStage";
import css from "./showcase.module.css";

// A dish in the Showcase menu: the stage (photo, 360°, 3D) on top, then its
// name, price, description, tags and option groups. With guest ordering on,
// the options are picked here (the POS's own rules: required groups, the
// most a group takes), then how many and Add to order; otherwise the
// options are shown and the guest is asked to show this to a waiter.

const S = MENU_STRINGS;
const T = MENU_STRINGS.showcase;

export type DishOrdering = { paused: boolean; onAdd: (line: { modifierIds: string[]; note: string; quantity: number }) => void };

function ruleOf(group: PublicModifierGroup, count: number): { text: string; state: "missing" | "met" | "optional" } {
  if (group.min > 0) return count >= group.min ? { text: T.done, state: "met" } : { text: S.required, state: "missing" };
  return { text: group.max > 1 ? S.pickUpTo(group.max) : T.optional, state: "optional" };
}

export default function ShowcaseDish({
  item,
  status,
  lighter,
  showSwitch,
  ordering,
  onClose,
  say,
}: {
  item: PublicMenuItem;
  status: MenuStatus;
  lighter: boolean;
  showSwitch: boolean;
  ordering: DishOrdering | null;
  onClose: () => void;
  say: (text: string) => void;
}) {
  const [mode, setMode] = useState<StageMode>("photo");
  const [picked, setPicked] = useState<string[]>([]);
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState("");
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panel.current?.querySelector<HTMLElement>("[data-item-close]")?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  const out = status !== "available";
  const canOrder = !!ordering && !ordering.paused && !out;
  const rules = item.modifiers.map((g) => ({ id: g.id, name: g.name, minSelect: g.min, maxSelect: g.max, optionIds: g.options.map((o) => o.id) }));
  const problem = checkSelection(rules, picked);
  const missing = missingGroups(item.modifiers, picked);
  const unit = item.kobo === null ? null : item.kobo + item.modifiers.flatMap((g) => g.options).filter((o) => picked.includes(o.id)).reduce((sum, o) => sum + (o.kobo ?? 0), 0);
  const amount = unit === null ? null : menuMoney(unit * quantity, item.price);

  return (
    <div className={`${css.scrim} ${css.dishScrim}`} onClick={onClose}>
      <div ref={panel} role="dialog" aria-modal="true" aria-label={item.name} data-item-sheet={item.id} className={css.dish} onClick={(e) => e.stopPropagation()}>
        <ShowcaseStage item={item} mode={mode} onMode={setMode} lighter={lighter} showSwitch={showSwitch} onClose={onClose} say={say} />

        <div className={css.dishBody}>
          <div className={css.dishHead}>
            <h2 className={css.dishName}>{item.name}</h2>
            {item.price && (
              <span data-item-price className={css.dishPrice}>
                {item.price}
              </span>
            )}
          </div>
          {item.description && <p className={css.dishDesc}>{item.description}</p>}
          {(out || item.signature || item.allergens.length > 0 || item.calories !== null || item.spin || item.model) && (
            <div className={css.tags} data-item-facts>
              {out && (
                <span data-item-state className={`${css.tag} ${css.tagOut}`}>
                  {status === "sold_out" ? S.soldOut : S.unavailable}
                </span>
              )}
              {item.signature && <span className={`${css.tag} ${css.tagMedia}`}>{S.signature}</span>}
              {item.allergens.map((a) => (
                <span key={a} className={`${css.tag} ${css.tagWarn}`} title={S.allergens}>
                  {a}
                </span>
              ))}
              {item.calories !== null && <span className={css.tag}>{S.calories(item.calories)}</span>}
              {item.spin && <span className={`${css.tag} ${css.tagMedia}`}>{T.spinView}</span>}
              {item.model && <span className={`${css.tag} ${css.tagMedia}`}>{T.modelView}</span>}
            </div>
          )}

          {item.modifiers.map((group) => {
            const count = group.options.filter((o) => picked.includes(o.id)).length;
            const rule = ruleOf(group, count);
            return (
              <fieldset key={group.id} className={css.group} data-order-group={group.name} data-item-group={group.name}>
                <legend className={css.groupHead}>
                  <span className={css.groupName}>{group.name}</span>
                  {canOrder ? (
                    <span className={css.groupRule} data-order-required={group.min > 0 ? (rule.state === "missing" ? "missing" : "met") : undefined} data-state={rule.state}>
                      {rule.text}
                    </span>
                  ) : (
                    group.rule && <span className={css.groupRule}>{group.rule}</span>
                  )}
                </legend>
                <div className={css.options}>
                  {group.options.map((option) => {
                    const on = picked.includes(option.id);
                    return (
                      <button
                        key={option.id}
                        type="button"
                        data-order-option={option.name}
                        aria-pressed={canOrder ? on : undefined}
                        aria-disabled={!canOrder}
                        className={css.option}
                        onClick={() => canOrder && setPicked((before) => toggleOption(before, group, option.id))}
                      >
                        {option.name}
                        {option.price && <span className={css.optionPrice}>{option.price}</span>}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            );
          })}
          {!ordering && item.modifiers.length > 0 && <p className={css.readOnly}>{S.optionsReadOnly}</p>}

          {canOrder && (
            <label className={css.noteField}>
              <span className={css.noteLabel}>{S.noteLabel}</span>
              <input data-order-note className={css.noteInput} value={note} maxLength={GUEST_NOTE_MAX} placeholder={S.notePlaceholder} onChange={(e) => setNote(e.target.value)} />
            </label>
          )}
        </div>

        <div className={css.dishFoot}>
          {canOrder && ordering ? (
            <>
              <div className={css.stepper} role="group" aria-label={S.quantity}>
                <button type="button" className={css.step} aria-label={S.less} data-order-less disabled={quantity <= 1} onClick={() => setQuantity((q) => Math.max(1, q - 1))}>
                  −
                </button>
                <span className={css.qty} data-order-qty aria-live="polite">
                  {quantity}
                </span>
                <button type="button" className={css.step} aria-label={S.more} data-order-more disabled={quantity >= GUEST_LINE_QTY_MAX} onClick={() => setQuantity((q) => Math.min(GUEST_LINE_QTY_MAX, q + 1))}>
                  +
                </button>
              </div>
              <button type="button" className={css.add} data-order-add disabled={!!problem} title={problem ?? undefined} onClick={() => !problem && ordering.onAdd({ modifierIds: picked, note: note.trim(), quantity })}>
                {missing.length ? T.choose(missing) : problem ? problem : T.addToOrder(amount)}
              </button>
            </>
          ) : out ? (
            <button type="button" className={css.add} disabled>
              {status === "sold_out" ? S.soldOut : S.unavailable}
            </button>
          ) : ordering?.paused ? (
            <span data-ordering-paused role="status" className={css.footNote}>
              {S.orderingPaused}
            </span>
          ) : (
            <span className={css.footNote}>
              {T.showWaiter} <b>{item.name}</b>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
