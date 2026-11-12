"use client";

import { useState, useTransition, type FormEvent } from "react";
import toast from "react-hot-toast";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { COLORS } from "@/components/layout/theme";
import { DEFAULT_QUICK_NOTES, MAX_QUICK_NOTES, QUICK_NOTE_MAX } from "../../lib/optionFlow";
import { setQuickNotes } from "../../server/actions/menuGroups";

const small = { width: 22, height: 22, border: "none", borderRadius: 5, background: "transparent", color: COLORS.slate, display: "flex", alignItems: "center", justifyContent: "center", padding: 0, cursor: "pointer" } as const;

// Food › POS buttons › Quick notes: the Note keypad's one-tap notes ("No
// onion", "Well done", "Allergy"), in the order shown. Each change saves at once.
export default function QuickNotesPanel({ notes }: { notes: string[] }) {
  const [draft, setDraft] = useState("");
  const [isPending, startTransition] = useTransition();

  function save(next: string[], done?: string) {
    startTransition(async () => {
      const result = await setQuickNotes(next);
      if (!result.ok) toast.error(result.error);
      else if (done) toast.success(done);
    });
  }

  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    if (notes.some((n) => n.toLowerCase() === text.toLowerCase())) return void toast.error(`"${text}" is already there.`);
    setDraft("");
    save([...notes, text]);
  }

  function move(i: number, by: -1 | 1) {
    const next = [...notes];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    save(next);
  }

  return (
    <section data-quick-notes style={{ background: "#fff", border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10, opacity: isPending ? 0.6 : 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Quick notes</h2>
        <span style={{ fontSize: 12.5, color: COLORS.slateMid }}>One tap on the POS Note keypad. Up to {MAX_QUICK_NOTES}, {QUICK_NOTE_MAX} characters each.</span>
        <button type="button" onClick={() => save(DEFAULT_QUICK_NOTES, "Quick notes back to the defaults.")} style={{ marginLeft: "auto", border: "none", background: "none", color: COLORS.teal, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
          Use the defaults
        </button>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        {notes.map((note, i) => (
          <span key={note} data-quick-note-chip={note} style={{ display: "flex", alignItems: "center", gap: 2, height: 32, padding: "0 4px 0 6px", border: `1px solid ${COLORS.borderStrong}`, borderRadius: 8, fontSize: 13, fontWeight: 600 }}>
            <button type="button" aria-label={`Move ${note} left`} disabled={i === 0} onClick={() => move(i, -1)} style={{ ...small, opacity: i === 0 ? 0.3 : 1 }}>
              <ChevronLeft size={14} />
            </button>
            <span style={{ padding: "0 4px" }}>{note}</span>
            <button type="button" aria-label={`Move ${note} right`} disabled={i === notes.length - 1} onClick={() => move(i, 1)} style={{ ...small, opacity: i === notes.length - 1 ? 0.3 : 1 }}>
              <ChevronRight size={14} />
            </button>
            <button type="button" aria-label={`Remove ${note}`} onClick={() => save(notes.filter((n) => n !== note))} style={{ ...small, color: COLORS.danger }}>
              <X size={14} />
            </button>
          </span>
        ))}
        {notes.length === 0 && <span style={{ fontSize: 13, color: COLORS.slateMid }}>No quick notes — the keypad shows only the keyboard.</span>}
        {notes.length < MAX_QUICK_NOTES && (
          <form onSubmit={add} style={{ display: "flex", gap: 6 }}>
            <input
              aria-label="New quick note"
              placeholder="e.g. No salt"
              value={draft}
              maxLength={QUICK_NOTE_MAX}
              onChange={(event) => setDraft(event.target.value)}
              style={{ height: 32, width: 170, border: `1px solid ${COLORS.borderStrong}`, borderRadius: 8, padding: "0 10px", fontSize: 13 }}
            />
            <button type="submit" disabled={!draft.trim()} style={{ height: 32, padding: "0 12px", border: "none", borderRadius: 8, background: draft.trim() ? COLORS.teal : COLORS.slateLight, color: "#fff", fontSize: 13, fontWeight: 600, cursor: draft.trim() ? "pointer" : "default" }}>
              Add
            </button>
          </form>
        )}
      </div>
    </section>
  );
}
