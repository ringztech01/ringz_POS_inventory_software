import type { Warehouse } from "@prisma/client";
import { Warehouse as WarehouseIcon, Eye, Pencil } from "lucide-react";
import { COLORS, FONTS } from "@/components/layout/theme";
import StatusChip from "@/components/ui/StatusChip";
import EmptyState from "@/components/ui/EmptyState";
import IconActionButton from "@/components/ui/IconActionButton";
import DeleteWarehouseButton from "./DeleteWarehouseButton";
import { formatDateTime } from "@/lib/format";

const GRID_COLUMNS = "minmax(240px,1.4fr) 150px 150px 140px 130px 150px 120px";
const HEADERS = ["Warehouse", "Phone number", "Country", "City", "Zip code", "Created on", "Action"];

export default function WarehouseTable({ warehouses }: { warehouses: Warehouse[] }) {
  if (warehouses.length === 0) {
    return <EmptyState icon={WarehouseIcon} message="No warehouses found." />;
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <div style={{ minWidth: 1120 }}>
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
          {HEADERS.map((label, i) => (
            <span
              key={label}
              style={{
                fontSize: 11.5,
                fontWeight: 600,
                letterSpacing: ".08em",
                textTransform: "uppercase",
                color: COLORS.slateMid,
                textAlign: i === HEADERS.length - 1 ? "right" : "left",
              }}
            >
              {label}
            </span>
          ))}
        </div>

        {warehouses.map((warehouse) => {
          const { time, date } = formatDateTime(warehouse.createdAt);
          return (
            <div
              key={warehouse.id}
              style={{
                display: "grid",
                gridTemplateColumns: GRID_COLUMNS,
                columnGap: 16,
                alignItems: "center",
                padding: "0 20px",
                height: 70,
                borderBottom: `1px solid ${COLORS.bgApp}`,
                whiteSpace: "nowrap",
              }}
            >
              <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.35, minWidth: 0 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{warehouse.name}</span>
                <span style={{ fontSize: 13, color: COLORS.slateMid }}>{warehouse.email}</span>
              </span>
              <span style={{ fontFamily: FONTS.mono, fontSize: 13, color: COLORS.text }}>{warehouse.phoneNumber}</span>
              <span style={{ fontSize: 14, color: COLORS.text }}>{warehouse.country}</span>
              <span style={{ fontSize: 14, color: COLORS.text }}>{warehouse.city}</span>
              <span style={{ fontFamily: FONTS.mono, fontSize: 13, color: COLORS.text }}>{warehouse.zipCode}</span>
              <StatusChip time={time} date={date} />
              <span style={{ justifySelf: "end", display: "flex", gap: 6 }}>
                <IconActionButton
                  icon={<Eye size={15} strokeWidth={1.8} />}
                  title="View warehouse"
                  href={`/warehouse/${warehouse.id}/edit`}
                  baseColor={COLORS.teal}
                />
                <IconActionButton
                  icon={<Pencil size={15} strokeWidth={1.8} />}
                  title="Edit warehouse"
                  href={`/warehouse/${warehouse.id}/edit`}
                />
                <DeleteWarehouseButton id={warehouse.id} name={warehouse.name} />
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
