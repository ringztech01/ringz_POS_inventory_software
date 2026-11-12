"use client";

import { useCallback, useState, type ReactNode } from "react";
import type { Approver } from "../../server/queries/approvers";
import PinSwitch from "./PinSwitch";

export type ManagerApproval = { approverId: string; pin: string };
// Shows the manager PIN pad; resolves true once `attempt` (with the PIN
// typed) succeeds, false if it's closed.
export type AskManager = (title: string, approvers: Approver[], attempt: (approval: ManagerApproval) => Promise<string | null>) => Promise<boolean>;

type Request = { title: string; approvers: Approver[]; attempt: (approval: ManagerApproval) => Promise<string | null>; resolve: (approved: boolean) => void };

// The manager PIN pad over the whole screen (Part 6e Step 6): a manager taps
// their name and types their PIN; a wrong one is said on the pad and can be
// typed again. `element` goes once in the page.
export function useManagerApproval(): { ask: AskManager; element: ReactNode } {
  const [request, setRequest] = useState<Request | null>(null);
  const ask = useCallback<AskManager>((title, approvers, attempt) => new Promise<boolean>((resolve) => setRequest({ title, approvers, attempt, resolve })), []);

  const element = request ? (
    <PinSwitch
      staff={request.approvers}
      withoutPin={0}
      locked={false}
      currentUserId=""
      title={request.title}
      emptyText="No one who can approve this has a PIN yet (an Administrator sets them on Settings › Staff)."
      onSubmit={async (approverId, pin) => {
        if (!approverId) return "Tap your name first, then your PIN.";
        const problem = await request.attempt({ approverId, pin });
        if (problem === null) {
          request.resolve(true);
          setRequest(null);
        }
        return problem;
      }}
      onClose={() => {
        request.resolve(false);
        setRequest(null);
      }}
    />
  ) : null;

  return { ask, element };
}

const NOT_APPROVED = "Not approved — nothing changed.";

// A change that may need a manager: tried as is; refused for want of a
// manager (`needs`), the PIN pad asks — and each PIN typed tries it again
// until it goes through (or `settled` says the manager's part is done, e.g.
// a waste approval is wanted next). Closing the pad leaves it undone.
// `remember` keeps the PIN that worked, for the same change tried again.
export async function withManager<T extends { ok: boolean; error?: string }>(
  run: (approval?: ManagerApproval) => Promise<T>,
  options: { needs: (outcome: T) => boolean; settled?: (outcome: T) => boolean; ask: AskManager; title: string; approvers: Approver[]; known?: ManagerApproval; remember?: (approval: ManagerApproval) => void },
): Promise<T | { ok: false; error: string }> {
  const settled = options.settled ?? ((outcome: T) => outcome.ok);
  const first = await run(options.known);
  if (first.ok || !options.needs(first)) return first;
  let last: T = first;
  const approved = await options.ask(options.title, options.approvers, async (approval) => {
    last = await run(approval);
    if (!settled(last)) return last.error ?? NOT_APPROVED;
    options.remember?.(approval);
    return null;
  });
  return approved ? last : { ok: false, error: NOT_APPROVED };
}
