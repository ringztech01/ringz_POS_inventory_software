import type { Metadata } from "next";

export const metadata: Metadata = { title: "Audit log — RingzPOS" };

// /settings/restaurant/audit — the audit log (Restaurant module; View Audit Log).
export { default } from "@/modules/restaurant/pages/AuditPage";
