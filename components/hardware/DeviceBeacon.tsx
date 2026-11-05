"use client";

import { useEffect } from "react";
import { registerDevice } from "@/lib/hardware/deviceActions";

// Mounted on the screens that print (POS, kitchen display, order screen,
// Settings › Printers): makes sure this browser is a known device, so its
// jobs can use a per-device printer. Renders nothing.
export default function DeviceBeacon() {
  useEffect(() => {
    void registerDevice();
  }, []);
  return null;
}
