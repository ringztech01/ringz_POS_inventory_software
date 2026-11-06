import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";

// Customer-facing screens: signed in (the till's browser), and nothing else
// around them — no sidebar, no printer badges.
export default async function DisplayLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  if (!session) redirect("/");
  return children;
}
