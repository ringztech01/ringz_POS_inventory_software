"use client";

import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { NOTE_MAX } from "../../lib/modifiers";
import { hasQuickNote, toggleQuickNote, typeKey } from "../../lib/optionFlow";
import { TOUCH } from "../../lib/theme";
import OnScreenKeyboard from "./OnScreenKeyboard";
import { doneKey, footerKey, panelStyle } from "./PanelFrame";
import TouchButton from "./TouchButton";

// The Note pad in the grid's place (the Restaurant POS design): the quick
// notes set up in Food › POS buttons — a tap puts one on, another takes it
// off (amber while on) — and Done. "Type a note" swaps them for the
// on-screen keyboard (a desk keyboard types too); Options… changes the
// line's options instead. Back on the crumb bar keeps the note, like Done;
// Esc drops the changes.
export default function NotePanel({
  lineName,
  initial,
  quickNotes,
  onSave,
  onOptions,
  onCancel,
  backRef,
}: {
  lineName: string;
  initial: string;
  quickNotes: string[];
  onSave: (note: string) => void;
  // The line has options: change them (the options panel).
  onOptions?: () => void;
  onCancel: () => void;
  backRef?: MutableRefObject<(() => void) | null>;
}) {
  const [note, setNote] = useState(initial);
  const [typing, setTyping] = useState(false);
  const latest = useRef(note);
  // Typed text beyond the quick notes (the lit keys show those).
  const typed = quickNotes.reduce((rest, phrase) => (hasQuickNote(rest, phrase) ? toggleQuickNote(rest, phrase) : rest), note).trim();
  const update = (next: string) => {
    latest.current = next;
    setNote(next);
  };

  // A desk keyboard: letters and the rest type, Backspace deletes, Enter
  // saves, Esc cancels.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "Escape") return onCancel();
      if (event.key === "Enter") return onSave(latest.current.trim());
      if (event.key === "Backspace") update(latest.current.slice(0, -1));
      else if (event.key.length === 1) update(typeKey(latest.current, event.key));
      else return;
      event.preventDefault();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel, onSave]);

  useEffect(() => {
    if (!backRef) return;
    backRef.current = () => onSave(latest.current.trim());
    return () => {
      backRef.current = null;
    };
  }, [backRef, onSave]);

  return (
    <div role="dialog" aria-label={`Note for ${lineName}`} data-note-panel data-pos-panel style={panelStyle}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexShrink: 0, minWidth: 0 }}>
        <span style={{ fontSize: 18, fontWeight: 700, color: TOUCH.text, overflowWrap: "anywhere" }}>Note for {lineName}</span>
        <span style={{ fontSize: 13, color: TOUCH.textDim, whiteSpace: "nowrap" }}>{typing ? "Type the note" : "Tap to add or remove"}</span>
      </div>

      {typing ? (
        <>
          <div data-note-text style={{ minHeight: 44, padding: "8px 12px", borderRadius: TOUCH.radius, background: TOUCH.check, color: TOUCH.ink, fontSize: 18, fontWeight: 600, display: "flex", alignItems: "center", gap: 2, overflowWrap: "anywhere", flexShrink: 0 }}>
            <span>{note}</span>
            <span aria-hidden style={{ width: 2, height: 22, background: TOUCH.teal }} />
            <span style={{ marginLeft: "auto", paddingLeft: 12, fontSize: 13, fontWeight: 600, color: TOUCH.inkFaint, fontFamily: TOUCH.mono }}>
              {note.length}/{NOTE_MAX}
            </span>
          </div>
          <div style={{ flex: 1, minHeight: 0, display: "grid" }}>
            <OnScreenKeyboard onKey={(key) => update(typeKey(latest.current, key))} onDelete={() => update(latest.current.slice(0, -1))} onClear={() => update("")} />
          </div>
        </>
      ) : (
        <>
          <div role="group" aria-label="Quick notes" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gridAutoRows: "minmax(52px, 76px)", gap: TOUCH.gap, alignContent: "start", flex: 1, minHeight: 0 }}>
            {quickNotes.map((phrase) => {
              const on = hasQuickNote(note, phrase);
              return (
                <TouchButton
                  key={phrase}
                  data-quick-note={phrase}
                  aria-pressed={on}
                  background={on ? TOUCH.amber : TOUCH.key}
                  color={on ? TOUCH.amberInk : "#fff"}
                  pressedBackground={on ? undefined : TOUCH.keyDown}
                  onClick={() => update(toggleQuickNote(latest.current, phrase))}
                  style={{ fontSize: 16, fontWeight: 700, padding: "0 8px", overflowWrap: "anywhere", lineHeight: 1.15 }}
                >
                  {phrase}
                </TouchButton>
              );
            })}
          </div>
          {typed && (
            <span data-note-text style={{ fontSize: 14, color: TOUCH.textDim, overflowWrap: "anywhere", flexShrink: 0 }}>
              » {note}
            </span>
          )}
        </>
      )}

      <div style={{ display: "flex", gap: TOUCH.gap, flexShrink: 0 }}>
        <TouchButton data-note-type background={TOUCH.key} onClick={() => setTyping((now) => !now)} style={footerKey}>
          {typing ? "Quick notes" : "Type a note"}
        </TouchButton>
        {onOptions && (
          <TouchButton data-change-options background={TOUCH.key} onClick={onOptions} style={footerKey}>
            Options…
          </TouchButton>
        )}
        <div style={{ flex: 1 }} />
        <TouchButton data-save-note background={TOUCH.teal} onClick={() => onSave(latest.current.trim())} style={doneKey}>
          Done
        </TouchButton>
      </div>
    </div>
  );
}
