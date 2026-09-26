"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight, ChevronDown } from "lucide-react";
import { useToggleState } from "@/components/layout/hooks";
import { COLORS } from "@/components/layout/theme";

const PER_PAGE_OPTIONS = [10, 25];

function NavButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled: boolean;
  children: React.ReactNode;
}) {
  const hover = useToggleState();
  const isHovered = hover.value && !disabled;

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={hover.on}
      onMouseLeave={hover.off}
      style={{
        width: 34,
        height: 34,
        border: `1px solid ${COLORS.borderStrong}`,
        background: isHovered ? COLORS.bgApp : "#fff",
        borderRadius: 8,
        color: disabled ? COLORS.slateLight : COLORS.slate,
        cursor: disabled ? "not-allowed" : "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {children}
    </button>
  );
}

export default function Pagination({
  page,
  perPage,
  total,
  totalPages,
}: {
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function navigate(nextPage: number, nextPerPage = perPage) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", String(nextPage));
    params.set("perPage", String(nextPerPage));
    router.push(`${pathname}?${params.toString()}`);
  }

  const start = total === 0 ? 0 : (page - 1) * perPage + 1;
  const end = Math.min(total, page * perPage);
  const canPrev = page > 1;
  const canNext = page < totalPages;

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: 13, color: COLORS.slate }}>Records per page</span>
        <div style={{ position: "relative" }}>
          <select
            value={perPage}
            onChange={(event) => navigate(1, Number(event.target.value))}
            style={{
              appearance: "none",
              height: 34,
              border: `1px solid ${COLORS.borderStrong}`,
              borderRadius: 8,
              padding: "0 32px 0 12px",
              fontSize: 13,
              background: "#fff",
              cursor: "pointer",
              outline: "none",
            }}
          >
            {PER_PAGE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <ChevronDown
            size={13}
            strokeWidth={1.8}
            color={COLORS.slateMid}
            style={{ position: "absolute", right: 10, top: 11, pointerEvents: "none" }}
          />
        </div>
        <span style={{ fontSize: 13, color: COLORS.slateMid }}>
          {start}–{end} of {total}
        </span>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <NavButton disabled={!canPrev} onClick={() => navigate(1)}>
          <ChevronsLeft size={14} strokeWidth={1.7} />
        </NavButton>
        <NavButton disabled={!canPrev} onClick={() => navigate(page - 1)}>
          <ChevronLeft size={14} strokeWidth={1.7} />
        </NavButton>
        <NavButton disabled={!canNext} onClick={() => navigate(page + 1)}>
          <ChevronRight size={14} strokeWidth={1.7} />
        </NavButton>
        <NavButton disabled={!canNext} onClick={() => navigate(totalPages)}>
          <ChevronsRight size={14} strokeWidth={1.7} />
        </NavButton>
      </div>
    </div>
  );
}
