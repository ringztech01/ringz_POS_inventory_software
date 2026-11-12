import type { Metadata } from "next";

export const metadata: Metadata = { title: "Floor plan — RingzPOS" };

// /pos/floor — the touch POS's full-screen floor plan (Restaurant mode only:
// a 404 while the module is off).
export { default } from "@/modules/restaurant/pages/PosFloorPage";
