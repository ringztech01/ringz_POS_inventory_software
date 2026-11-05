import Link from "next/link";
import { SearchX } from "lucide-react";
import { COLORS, FONTS } from "@/components/layout/theme";

// /restaurant/orders/[id] for an order that doesn't exist or was deleted.
export default function OrderNotFound() {
  return (
    <div
      style={{
        background: "#fff",
        border: `1px solid ${COLORS.border}`,
        borderRadius: 12,
        padding: "56px 24px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 12,
        textAlign: "center",
      }}
    >
      <span style={{ width: 48, height: 48, borderRadius: 12, background: COLORS.bgApp, color: COLORS.slateMid, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <SearchX size={22} strokeWidth={1.7} />
      </span>
      <h1 style={{ margin: 0, fontFamily: FONTS.display, fontSize: 22, fontWeight: 700 }}>Order not found</h1>
      <p style={{ margin: 0, fontSize: 13.5, color: COLORS.slateMid, maxWidth: 420 }}>
        It may have been deleted, or the link is out of date.
      </p>
      <Link href="/restaurant/floor" style={{ marginTop: 8, fontSize: 13.5, fontWeight: 600, color: COLORS.teal, textDecoration: "none" }}>
        ← Back to the floor
      </Link>
    </div>
  );
}
