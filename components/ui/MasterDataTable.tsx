import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Image as ImageIcon, Pencil } from "lucide-react";
import { COLORS, FONTS } from "@/components/layout/theme";
import EmptyState from "@/components/ui/EmptyState";
import IconActionButton from "@/components/ui/IconActionButton";

const GRID_COLUMNS = "40px minmax(240px,1fr) 160px 120px";

export type MasterDataRow = {
  id: string;
  name: string;
  logo?: string | null;
  products: number;
};

function Checkbox() {
  return (
    <span
      style={{
        width: 18,
        height: 18,
        borderRadius: 5,
        border: "1.5px solid #c3cacc",
        background: "#fff",
      }}
    />
  );
}

function Logo({ src }: { src: string | null }) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        style={{ width: 44, height: 44, flex: "0 0 auto", borderRadius: 10, objectFit: "cover" }}
      />
    );
  }

  return (
    <span
      style={{
        width: 44,
        height: 44,
        flex: "0 0 auto",
        borderRadius: 10,
        border: `1px solid ${COLORS.border}`,
        backgroundColor: COLORS.bgInput,
        backgroundImage: `repeating-linear-gradient(135deg, ${COLORS.border} 0 6px, transparent 6px 12px)`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: COLORS.slateLight,
      }}
    >
      <ImageIcon size={16} strokeWidth={1.8} />
    </span>
  );
}

export default function MasterDataTable<T extends MasterDataRow>({
  items,
  columnLabel,
  emptyIcon,
  emptyMessage,
  onEdit,
  renderDelete,
  showLogo = true,
}: {
  items: T[];
  columnLabel: string;
  emptyIcon: LucideIcon;
  emptyMessage: string;
  onEdit: (item: T) => void;
  renderDelete: (item: T) => ReactNode;
  showLogo?: boolean;
}) {
  if (items.length === 0) {
    return <EmptyState icon={emptyIcon} message={emptyMessage} />;
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <div style={{ minWidth: 760 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: GRID_COLUMNS,
            columnGap: 16,
            alignItems: "center",
            padding: "0 20px",
            height: 44,
            background: COLORS.bgInput,
            borderBottom: `1px solid ${COLORS.border}`,
            whiteSpace: "nowrap",
          }}
        >
          <Checkbox />
          <span
            style={{
              fontSize: 11.5,
              fontWeight: 600,
              letterSpacing: ".08em",
              textTransform: "uppercase",
              color: COLORS.slateMid,
            }}
          >
            {columnLabel}
          </span>
          <span
            style={{
              fontSize: 11.5,
              fontWeight: 600,
              letterSpacing: ".08em",
              textTransform: "uppercase",
              color: COLORS.slateMid,
              textAlign: "right",
            }}
          >
            Products
          </span>
          <span
            style={{
              fontSize: 11.5,
              fontWeight: 600,
              letterSpacing: ".08em",
              textTransform: "uppercase",
              color: COLORS.slateMid,
              textAlign: "right",
            }}
          >
            Action
          </span>
        </div>

        {items.map((item) => (
          <div
            key={item.id}
            style={{
              display: "grid",
              gridTemplateColumns: GRID_COLUMNS,
              columnGap: 16,
              alignItems: "center",
              padding: "0 20px",
              height: 68,
              borderBottom: `1px solid ${COLORS.bgApp}`,
              whiteSpace: "nowrap",
            }}
          >
            <Checkbox />
            <span style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
              {showLogo && <Logo src={item.logo ?? null} />}
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 500,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  fontFamily: FONTS.body,
                }}
              >
                {item.name}
              </span>
            </span>
            <span style={{ fontFamily: FONTS.mono, fontSize: 13, textAlign: "right", color: COLORS.slate }}>
              {item.products}
            </span>
            <span style={{ display: "flex", gap: 8, justifySelf: "end" }}>
              <IconActionButton
                icon={<Pencil size={15} strokeWidth={1.8} />}
                title="Edit"
                size={34}
                onClick={() => onEdit(item)}
              />
              {renderDelete(item)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
