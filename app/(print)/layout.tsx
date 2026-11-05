import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";

// Pages made to be printed (the restaurant's QR sheet): signed in, but no
// sidebar or top bar to print. Each page checks its own permission.
export default async function PrintLayout({ children }: { children: ReactNode }) {
  const session = await auth();

  if (!session) {
    redirect("/");
  }

  return <div style={{ minHeight: "100vh", background: "#eef1f4" }}>{children}</div>;
}
