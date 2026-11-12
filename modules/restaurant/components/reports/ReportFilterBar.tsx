"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import { COLORS } from "@/components/layout/theme";
import type { DateRange } from "@/lib/dateRanges";
import ReportDatePicker from "@/components/reports/ReportDatePicker";
import { ORDER_TYPE_LABELS, REPORT_FILTER_PARAMS } from "../../lib/reportTabs";

type Option = { id: string; name: string };

export type ReportFilterValues = { area: string | null; waiter: string | null; type: string | null; station: string | null; device: string | null };

function FilterSelect({ label, all, param, value, options, onChange }: { label: string; all: string; param: string; value: string | null; options: Option[]; onChange: (param: string, value: string) => void }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5, fontWeight: 600, color: COLORS.slateMid, textTransform: "uppercase", letterSpacing: ".04em" }}>
      {label}
      <select
        aria-label={label}
        data-report-filter={param}
        value={value ?? ""}
        onChange={(event) => onChange(param, event.target.value)}
        style={{ height: 40, minWidth: 150, maxWidth: 200, border: `1px solid ${value ? COLORS.tealBorder : COLORS.borderStrong}`, borderRadius: 8, padding: "0 10px", fontSize: 13.5, background: value ? COLORS.tealTint : "#fff", color: COLORS.ink, textTransform: "none", letterSpacing: 0, fontWeight: 500 }}
      >
        <option value="">{all}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );
}

// The filter bar every Restaurant Reports tab shares: the period (quick
// ranges on the business day, or From / To), then dining area, waiter,
// order type, station and device. Everything lives in the URL, so it stays
// as you move between tabs and a link opens the same report.
export default function ReportFilterBar({
  presets,
  current,
  values,
  areas,
  waiters,
  stations,
  devices,
}: {
  presets: { label: string; range: DateRange }[];
  current: DateRange;
  values: ReportFilterValues;
  areas: Option[];
  waiters: Option[];
  stations: Option[];
  devices: Option[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function change(param: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(param, value);
    else params.delete(param);
    router.push(`${pathname}?${params.toString()}`);
  }

  function clearAll() {
    const params = new URLSearchParams(searchParams.toString());
    for (const key of REPORT_FILTER_PARAMS) params.delete(key);
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  const anyFilter = Object.values(values).some(Boolean) || searchParams.has("from") || searchParams.has("to");
  const types = Object.entries(ORDER_TYPE_LABELS).map(([id, name]) => ({ id, name }));

  return (
    <div data-report-filters style={{ display: "flex", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5, fontWeight: 600, color: COLORS.slateMid, textTransform: "uppercase", letterSpacing: ".04em" }}>
        Period
        <ReportDatePicker presets={presets} current={current} width={230} />
      </label>
      {areas.length > 0 && <FilterSelect label="Dining area" all="All areas" param="area" value={values.area} options={areas} onChange={change} />}
      {waiters.length > 0 && <FilterSelect label="Waiter" all="All waiters" param="waiter" value={values.waiter} options={waiters} onChange={change} />}
      <FilterSelect label="Order type" all="All types" param="type" value={values.type} options={types} onChange={change} />
      {stations.length > 0 && <FilterSelect label="Station" all="All stations" param="station" value={values.station} options={stations} onChange={change} />}
      {devices.length > 0 && <FilterSelect label="Device" all="All devices" param="device" value={values.device} options={devices} onChange={change} />}
      {anyFilter && (
        <button
          type="button"
          data-report-clear
          onClick={clearAll}
          style={{ height: 40, padding: "0 12px", display: "flex", alignItems: "center", gap: 6, background: "#fff", border: `1px solid ${COLORS.borderStrong}`, borderRadius: 8, fontSize: 13, fontWeight: 600, color: COLORS.text, cursor: "pointer" }}
        >
          <X size={14} strokeWidth={1.8} />
          Clear filters
        </button>
      )}
    </div>
  );
}
