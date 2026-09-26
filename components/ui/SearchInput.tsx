"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { useToggleState } from "@/components/layout/hooks";
import { COLORS } from "@/components/layout/theme";

export default function SearchInput({
  paramName = "q",
  placeholder = "Search",
  width = 340,
}: {
  paramName?: string;
  placeholder?: string;
  width?: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(searchParams.get(paramName) ?? "");
  const focus = useToggleState();

  useEffect(() => {
    const handle = setTimeout(() => {
      const current = searchParams.get(paramName) ?? "";
      if (value === current) return;

      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set(paramName, value);
      } else {
        params.delete(paramName);
      }
      params.delete("page");
      router.push(`${pathname}?${params.toString()}`);
    }, 300);

    return () => clearTimeout(handle);
    // Only re-run when the field's own value changes; re-reading searchParams
    // on every render would fight the debounce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div style={{ position: "relative", width }}>
      <Search
        size={15}
        strokeWidth={1.6}
        color={COLORS.slateMid}
        style={{ position: "absolute", left: 12, top: 11 }}
      />
      <input
        placeholder={placeholder}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onFocus={focus.on}
        onBlur={focus.off}
        style={{
          width: "100%",
          height: 38,
          border: `1px solid ${focus.value ? COLORS.teal : COLORS.borderStrong}`,
          borderRadius: 8,
          padding: "0 12px 0 34px",
          fontSize: 13.5,
          outline: "none",
          boxShadow: focus.value ? `0 0 0 3px ${COLORS.focusRing}` : "none",
        }}
      />
    </div>
  );
}
