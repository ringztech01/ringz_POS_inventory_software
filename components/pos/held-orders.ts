"use client";

import { useCallback, useEffect, useState } from "react";
import type { PurchaseLine } from "@/components/purchases/PurchaseForm";

// A cart put on hold: only what's needed to rebuild it. Holding never creates
// a Sale or moves stock — that happens only at payment (createSale).
export type HeldOrder = {
  id: string;
  // ISO time it was held.
  heldAt: string;
  customerId: string;
  warehouseId: string;
  lines: PurchaseLine[];
  orderTax: string;
  discount: string;
  shipping: string;
};

// Kept in this browser (localStorage), per signed-in user: survives a refresh,
// closing the tab and signing back in on the same till; not shared between
// computers.
const storageKey = (userId: string) => `ringzpos:pos-held:${userId || "anonymous"}`;

const isHeldOrder = (value: unknown): value is HeldOrder => {
  const order = value as HeldOrder;
  return (
    !!order &&
    typeof order.id === "string" &&
    typeof order.heldAt === "string" &&
    typeof order.customerId === "string" &&
    typeof order.warehouseId === "string" &&
    Array.isArray(order.lines) &&
    order.lines.every((line) => line && typeof line.productId === "string" && typeof line.quantity === "number")
  );
};

function read(key: string): HeldOrder[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(key) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isHeldOrder) : [];
  } catch {
    return [];
  }
}

function write(key: string, orders: HeldOrder[]) {
  try {
    window.localStorage.setItem(key, JSON.stringify(orders));
  } catch {
    // Storage full or blocked: the list still works for this page's life.
  }
}

// The held orders, oldest first. Read after mount (the server render has no
// storage), written on every change, and kept in step with other tabs.
export function useHeldOrders(userId: string) {
  const key = storageKey(userId);
  const [orders, setOrders] = useState<HeldOrder[]>([]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- storage only exists after mount
    setOrders(read(key));
    function onStorage(event: StorageEvent) {
      if (event.key === key) setOrders(read(key));
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [key]);

  const update = useCallback(
    (change: (current: HeldOrder[]) => HeldOrder[]) => {
      setOrders((current) => {
        const next = change(current);
        write(key, next);
        return next;
      });
    },
    [key],
  );

  const hold = useCallback(
    (order: Omit<HeldOrder, "id" | "heldAt">) =>
      update((current) => [...current, { ...order, id: crypto.randomUUID(), heldAt: new Date().toISOString() }]),
    [update],
  );
  const remove = useCallback((id: string) => update((current) => current.filter((order) => order.id !== id)), [update]);

  return { orders, hold, remove };
}
