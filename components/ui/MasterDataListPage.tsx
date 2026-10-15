"use client";

import { Suspense, useState, type ReactNode } from "react";
import { Plus, Filter } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { COLORS, FONTS } from "@/components/layout/theme";
import PrimaryButton from "@/components/ui/PrimaryButton";
import SearchInput from "@/components/ui/SearchInput";
import Pagination from "@/components/ui/Pagination";
import MasterDataTable, { type MasterDataRow } from "@/components/ui/MasterDataTable";

export type MasterDataModalState<T> = { item: T | null };

export default function MasterDataListPage<T extends MasterDataRow>({
  title,
  entityNameSingular,
  entityNamePlural,
  createLabel,
  columnLabel,
  emptyIcon,
  emptyMessage,
  items,
  total,
  page,
  perPage,
  totalPages,
  renderDelete,
  renderModal,
  showLogo = true,
}: {
  title: string;
  entityNameSingular: string;
  entityNamePlural: string;
  createLabel: string;
  columnLabel: string;
  emptyIcon: LucideIcon;
  emptyMessage: string;
  items: T[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
  renderDelete: (item: T) => ReactNode;
  renderModal: (modal: MasterDataModalState<T>, close: () => void) => ReactNode;
  showLogo?: boolean;
}) {
  const [modal, setModal] = useState<MasterDataModalState<T> | null>(null);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16 }}>
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
          <p style={{ margin: 0, fontSize: 13.5, color: COLORS.slateMid }}>
            {total} {total === 1 ? entityNameSingular : entityNamePlural}
          </p>
        </div>
        <PrimaryButton onClick={() => setModal({ item: null })}>
          <Plus size={14} strokeWidth={1.9} />
          {createLabel}
        </PrimaryButton>
      </div>

      <div
        style={{
          background: "#fff",
          border: `1px solid ${COLORS.border}`,
          borderRadius: 12,
          boxShadow: "0 1px 2px rgba(23,27,28,.06)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            padding: "18px 20px",
            borderBottom: `1px solid ${COLORS.border}`,
          }}
        >
          <Suspense fallback={null}>
            <SearchInput />
          </Suspense>
          <button
            type="button"
            style={{
              height: 38,
              padding: "0 14px",
              display: "flex",
              alignItems: "center",
              gap: 8,
              background: "#fff",
              border: `1px solid ${COLORS.borderStrong}`,
              borderRadius: 8,
              fontSize: 13.5,
              fontWeight: 600,
              color: COLORS.text,
              cursor: "pointer",
            }}
          >
            <Filter size={14} strokeWidth={1.6} />
            Filters
          </button>
        </div>

        <MasterDataTable
          items={items}
          columnLabel={columnLabel}
          emptyIcon={emptyIcon}
          emptyMessage={emptyMessage}
          onEdit={(item) => setModal({ item })}
          renderDelete={renderDelete}
          showLogo={showLogo}
        />

        <Suspense fallback={null}>
          <Pagination page={page} perPage={perPage} total={total} totalPages={totalPages} />
        </Suspense>
      </div>

      {modal && renderModal(modal, () => setModal(null))}
    </div>
  );
}
