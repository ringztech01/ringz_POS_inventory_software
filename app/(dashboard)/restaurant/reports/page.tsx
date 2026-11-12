import ReportsPage from "@/modules/restaurant/pages/ReportsPage";

// /restaurant/reports — Restaurant Reports, the Overview tab.
export default function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <ReportsPage tab="overview" searchParams={searchParams} />;
}
