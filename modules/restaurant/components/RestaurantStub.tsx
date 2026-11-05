import { Construction } from "lucide-react";
import { COLORS, FONTS } from "@/components/layout/theme";
import EmptyState from "@/components/ui/EmptyState";

// Placeholder for a restaurant screen that isn't built yet: the page title
// (the designs' h1 style) and an empty card.
export default function RestaurantStub({ title }: { title: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <h1 style={{ margin: 0, fontFamily: FONTS.display, fontSize: 24, fontWeight: 600, letterSpacing: "-.01em" }}>
        {title}
      </h1>
      <div style={{ background: "#fff", border: `1px solid ${COLORS.border}`, borderRadius: 12 }}>
        <EmptyState icon={Construction} message="This screen is coming soon." />
      </div>
    </div>
  );
}
