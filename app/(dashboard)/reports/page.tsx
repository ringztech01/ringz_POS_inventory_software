import { redirect } from "next/navigation";

// /reports → the landing tab.
export default function ReportsIndexPage() {
  redirect("/reports/warehouse");
}
