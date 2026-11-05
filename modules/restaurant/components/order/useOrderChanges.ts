"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import type { OrderChangeResult } from "../../server/services/orders";

// Every change the order screen makes goes through `run`: one at a time, each
// sent with the newest version this screen knows (the page's, or the one the
// last change returned) — so the screen's own quick taps never look stale to
// the server. A refusal shows its message; if the order moved on elsewhere
// (`stale`), the screen reloads from the server. `quiet`: a form that shows
// its own refusals (the discount's wrong PIN) — no toast unless stale.
export function useOrderChanges(serverVersion: number) {
  const router = useRouter();
  const version = useRef(serverVersion);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const [inFlight, setInFlight] = useState(0);

  useEffect(() => {
    version.current = Math.max(version.current, serverVersion);
  }, [serverVersion]);

  const run = useCallback(
    (change: (version: number) => Promise<OrderChangeResult>, { quiet = false }: { quiet?: boolean } = {}): Promise<boolean> => {
      setInFlight((n) => n + 1);
      const task = queue.current.then(async () => {
        try {
          const result = await change(version.current);
          if (result.ok) {
            version.current = result.version;
            return true;
          }
          if (!quiet || result.stale) toast.error(result.error);
          if (result.stale) router.refresh();
          return false;
        } catch {
          toast.error("Couldn't reach the server. Check the connection and try again.");
          router.refresh();
          return false;
        } finally {
          setInFlight((n) => n - 1);
        }
      });
      queue.current = task;
      return task;
    },
    [router],
  );

  return { run, saving: inFlight > 0 };
}
