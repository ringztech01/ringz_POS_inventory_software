import Link from "next/link";
import type { Customer } from "@prisma/client";
import { Users, Pencil } from "lucide-react";
import { COLORS, FONTS } from "@/components/layout/theme";
import StatusChip from "@/components/ui/StatusChip";
import EmptyState from "@/components/ui/EmptyState";
import IconActionButton from "@/components/ui/IconActionButton";
import DeleteCustomerButton from "./DeleteCustomerButton";
import { formatDateTime } from "@/lib/format";

const GRID_COLUMNS = "minmax(240px,1fr) 200px 180px 110px";
const HEADERS = ["Customer", "Phone number", "Created on", "Action"];

export default function CustomerTable({ customers }: { customers: Customer[] }) {
  if (customers.length === 0) {
    return <EmptyState icon={Users} message="No customers found." />;
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <div style={{ minWidth: 780 }}>
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

        {customers.map((customer) => {
          const { time, date } = formatDateTime(customer.createdAt);
          return (
            <div
              key={customer.id}
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
              <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.35, minWidth: 0 }}>
                <Link href={`/peoples/customers/${customer.id}/edit`} style={{ fontSize: 14, fontWeight: 600 }}>
                  {customer.name}
                </Link>
                <span style={{ fontSize: 13, color: COLORS.slateMid }}>{customer.email}</span>
              </span>
              <span style={{ fontFamily: FONTS.mono, fontSize: 13, color: COLORS.text }}>{customer.phoneNumber}</span>
              <StatusChip time={time} date={date} />
              <span style={{ justifySelf: "end", display: "flex", gap: 6 }}>
                <IconActionButton
                  icon={<Pencil size={15} strokeWidth={1.8} />}
                  title="Edit customer"
                  href={`/peoples/customers/${customer.id}/edit`}
                />
                <DeleteCustomerButton id={customer.id} name={customer.name} disabled={customer.isDefault} />
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
