"use client";

import { useEffect, useRef, useState } from "react";
import { previewWasteCost } from "../../server/actions/waste";
import type { WasteCostPreview } from "../../server/services/waste";

const PREVIEW_DELAY_MS = 300;

export type WastePreview = { state: "idle" } | { state: "loading" } | { state: "done"; result: WasteCostPreview };

// The live cost of wasting `qty` of an item (the server's previewWasteCost):
// asked a moment after the item or quantity last changed; only the latest
// answer counts. Idle without an item or a quantity above 0.
export function useWastePreview(productId: string | null, qty: string): WastePreview {
  const [answer, setAnswer] = useState<{ key: string; result: WasteCostPreview } | null>(null);
  const asked = useRef(0);
  const key = productId && Number(qty) > 0 ? `${productId}|${qty}` : null;

  useEffect(() => {
    const ask = ++asked.current;
    if (!key) return;
    const [id, amount] = key.split("|");
    const timer = setTimeout(async () => {
      const result = await previewWasteCost({ productId: id, qty: amount });
      if (ask === asked.current) setAnswer({ key, result });
    }, PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [key]);

  if (!key) return { state: "idle" };
  return answer?.key === key ? { state: "done", result: answer.result } : { state: "loading" };
}
