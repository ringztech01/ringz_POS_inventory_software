"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { HEADER_ACTIONS_ID } from "../lib/headerSlot";

const noSubscription = () => () => {};

// A page's controls for the right end of RestaurantHeader (the designs put
// e.g. "New takeaway" there). The header is in the layout, so pages can't
// pass it props; this renders them into its slot instead. The slot is read
// after hydration (null on the server).
export default function HeaderActions({ children }: { children: ReactNode }) {
  const slot = useSyncExternalStore(
    noSubscription,
    () => document.getElementById(HEADER_ACTIONS_ID),
    () => null,
  );
  return slot ? createPortal(children, slot) : null;
}
