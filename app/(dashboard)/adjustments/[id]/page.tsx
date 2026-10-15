import type { ReactNode } from "react";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { FONTS } from "@/components/layout/theme";
import DetailView from "@/components/ui/DetailView";
import AdjustmentItemsTable from "@/components/adjustments/AdjustmentItemsTable";
import { formatDateTime } from "@/lib/format";
import { getAdjustmentById } from "../queries";

function Mono({ children }: { children: ReactNode }) {
  return <span style={{ fontFamily: FONTS.mono }}>{children}</span>;
}

export default async function AdjustmentViewPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/");
  }

  const { id } = await params;
  const adjustment = await getAdjustmentById(id);

  if (!adjustment) {
    notFound();
  }

  const { date: adjustmentDate } = formatDateTime(adjustment.date);
  const createdOn = formatDateTime(adjustment.createdAt);
  const createdByName = `${adjustment.createdBy.firstName} ${adjustment.createdBy.lastName}`;

  return (
    <DetailView
      title={adjustment.reference}
      subtitle={`${adjustment.warehouse.name} · ${adjustmentDate}`}
      backHref="/adjustments"
      sections={[
        {
          fields: [
            { label: "Reference", value: <Mono>{adjustment.reference}</Mono> },
            { label: "Warehouse", value: adjustment.warehouse.name },
            { label: "Date", value: <Mono>{adjustmentDate}</Mono> },
            { label: "Created by", value: createdByName },
            {
              label: "Created on",
              value: (
                <Mono>
                  {createdOn.date} · {createdOn.time}
                </Mono>
              ),
            },
          ],
        },
      ]}
      extra={<AdjustmentItemsTable items={adjustment.items} />}
    />
  );
}
