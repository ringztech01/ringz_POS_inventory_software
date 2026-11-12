import { notFound } from "next/navigation";
import ReportsPage from "@/modules/restaurant/pages/ReportsPage";
import { reportTabFor } from "@/modules/restaurant/lib/reportTabs";

// /restaurant/reports/<tab> — the other Restaurant Reports tabs (Prep times
// keeps its own route beside this one).
export default async function Page({ params, searchParams }: { params: Promise<{ tab: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const tab = reportTabFor((await params).tab);
  if (!tab) notFound();
  return <ReportsPage tab={tab.key} searchParams={searchParams} />;
}
