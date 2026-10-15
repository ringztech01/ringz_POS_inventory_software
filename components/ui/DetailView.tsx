import type { ReactNode } from "react";
import { ArrowLeft, Pencil } from "lucide-react";
import { COLORS, FONTS } from "@/components/layout/theme";
import GhostButton from "@/components/ui/GhostButton";
import PrimaryButton from "@/components/ui/PrimaryButton";

export type DetailField = {
  label: string;
  value: ReactNode;
  wide?: boolean;
};

export type DetailSection = {
  heading?: string;
  fields: DetailField[];
};

// Generic read-only "view" page shell: header with Back/Edit actions, a card
// with an optional gallery slot, one or more label/value field sections, and
// an optional trailing slot for anything bespoke (e.g. a stock table). Any
// module that needs a detail page can reuse this instead of building its own
// card chrome.
export default function DetailView({
  title,
  subtitle,
  editHref,
  backHref,
  gallery,
  sections,
  extra,
}: {
  title: string;
  subtitle?: string;
  editHref?: string;
  backHref: string;
  gallery?: ReactNode;
  sections: DetailSection[];
  extra?: ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <h1
            style={{
              margin: 0,
              fontFamily: FONTS.display,
              fontSize: 26,
              fontWeight: 700,
              letterSpacing: "-.015em",
            }}
          >
            {title}
          </h1>
          {subtitle && <p style={{ margin: 0, fontSize: 13.5, color: COLORS.slateMid }}>{subtitle}</p>}
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <GhostButton href={backHref} paddingX={18}>
            <ArrowLeft size={14} strokeWidth={1.7} />
            Back
          </GhostButton>
          {editHref && (
            <PrimaryButton href={editHref} paddingX={20} fontSize={14}>
              <Pencil size={14} strokeWidth={1.8} />
              Edit
            </PrimaryButton>
          )}
        </div>
      </div>

      <div
        style={{
          background: "#fff",
          border: `1px solid ${COLORS.border}`,
          borderRadius: 12,
          boxShadow: "0 1px 2px rgba(23,27,28,.06)",
          padding: 32,
          display: "flex",
          flexDirection: "column",
          gap: 28,
        }}
      >
        {gallery}

        {sections.map((section, sectionIndex) => (
          <div key={section.heading ?? sectionIndex} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {section.heading && (
              <h3 style={{ margin: 0, fontFamily: FONTS.display, fontSize: 16, fontWeight: 600 }}>
                {section.heading}
              </h3>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: "18px 32px" }}>
              {section.fields.map((field) => (
                <div
                  key={field.label}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                    gridColumn: field.wide ? "1 / -1" : undefined,
                  }}
                >
                  <span
                    style={{
                      fontSize: 11.5,
                      fontWeight: 600,
                      letterSpacing: ".06em",
                      textTransform: "uppercase",
                      color: COLORS.slateMid,
                    }}
                  >
                    {field.label}
                  </span>
                  <span style={{ fontSize: 14, color: COLORS.text }}>{field.value}</span>
                </div>
              ))}
            </div>
          </div>
        ))}

        {extra}
      </div>
    </div>
  );
}
