import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { MENU_STRINGS as S } from "../lib/menuStrings";
import { loadPublicMenu, menuDesign } from "../server/queries/publicMenu";
import PublicMenu from "../components/publicMenu/PublicMenu";
import ShowcaseMenu from "../components/publicMenu/showcase/ShowcaseMenu";

// /menu/[qrToken] — the guest's digital menu (Part 8 Step 3): public, on the
// restaurant's Wi-Fi, no sign-in. 404 while the module is off; a code that
// was rotated, removed or mistyped gets a friendly message instead. In the
// Showcase design (the default) or Classic, as Digital menu › QR codes says.

export const metadata: Metadata = { title: S.defaultTitle, robots: { index: false, follow: false } };
// The phone's browser bar matches the design.
export async function generateViewport(): Promise<Viewport> {
  return { width: "device-width", initialScale: 1, themeColor: (await menuDesign()) === "CLASSIC" ? "#0f7d6a" : "#14100D" };
}

const FONT = `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;

function Message({ heading, title, body }: { heading?: string; title: string; body: string }) {
  return (
    <div data-menu-message style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, background: "#fafbfb", fontFamily: FONT, color: "#171b1c" }}>
      <div style={{ maxWidth: 340, textAlign: "center", display: "flex", flexDirection: "column", gap: 8 }}>
        {heading && <span style={{ fontSize: 13, color: "#6d777a" }}>{heading}</span>}
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, lineHeight: 1.3 }}>{title}</h1>
        <p style={{ margin: 0, fontSize: 15, color: "#4d5659" }}>{body}</p>
      </div>
    </div>
  );
}

export default async function PublicMenuPage({ params }: { params: Promise<{ qrToken: string }> }) {
  const { qrToken } = await params;
  const page = await loadPublicMenu(qrToken);
  if (page.kind === "off") notFound();
  if (page.kind === "inactive") return <Message title={S.inactiveTitle} body={S.inactiveBody} />;
  if (page.kind === "closed") return <Message heading={page.title} title={S.closedTitle} body={S.closedBody} />;
  if (page.design === "SHOWCASE") {
    return <ShowcaseMenu token={qrToken} where={page.where} header={page.header} sections={page.sections} items={page.items} departments={page.departments} service={page.service} ordering={page.ordering} />;
  }
  return <PublicMenu token={qrToken} where={page.where} header={page.header} sections={page.sections} items={page.items} departments={page.departments} service={page.service} ordering={page.ordering} />;
}
