"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import toast from "react-hot-toast";

// A Print button that knows where the job goes:
//   printer set   sends the job to the print queue (the server prints it on
//                 that printer) — "Sent to Kitchen printer."
//   no printer    the browser's print page, as before printers were set up
//                 (`href`, in a new tab)
// `onQueue` is the server action; it answers { ok, printer } or an error.

export type QueueAnswer = { ok: true; printer: string | null } | { ok: false; error: string };

export default function PrintButton({
  printer,
  href,
  onQueue,
  children,
  style,
  disabled,
  ariaLabel,
}: {
  printer: string | null;
  href: string;
  onQueue: () => Promise<QueueAnswer>;
  children: ReactNode;
  style: CSSProperties;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const [sending, setSending] = useState(false);
  if (!printer) {
    return (
      <a href={href} target="_blank" rel="noopener" aria-label={ariaLabel} aria-disabled={disabled} data-print="browser" style={{ ...style, pointerEvents: disabled ? "none" : undefined }}>
        {children}
      </a>
    );
  }
  async function send() {
    setSending(true);
    try {
      const answer = await onQueue();
      if (!answer.ok) toast.error(answer.error);
      else if (answer.printer) toast.success(`Sent to ${answer.printer}.`);
      // The role lost its printer meanwhile: the browser page instead.
      else window.open(href, "_blank", "noopener");
    } catch {
      toast.error("Couldn't reach the server — check the connection and try again.");
    } finally {
      setSending(false);
    }
  }
  return (
    <button type="button" aria-label={ariaLabel} data-print="queue" title={`Prints on ${printer}`} disabled={disabled || sending} onClick={() => void send()} style={{ ...style, cursor: disabled || sending ? "default" : "pointer", opacity: sending ? 0.7 : 1 }}>
      {children}
    </button>
  );
}
