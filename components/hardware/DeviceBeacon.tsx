"use client";

import { useEffect } from "react";
import { registerDevice } from "@/lib/hardware/deviceActions";

// Mounted on the screens that print (POS, kitchen display, order screen,
// Settings › Printers) and the tablet screens: makes sure this browser is a
// known device, so its jobs can use a per-device printer, and says whether
// it has a touch screen (Part 6g's Auto: an iPad's Safari says it's a Mac).
// Renders nothing.
export default function DeviceBeacon() {
  useEffect(() => {
    void registerDevice({ touch: navigator.maxTouchPoints > 1 });
  }, []);
  return null;
}
