import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { COLORS, FONTS } from "@/components/layout/theme";
import { RESTAURANT_PERMISSIONS } from "../manifest";
import { guardPage } from "../server/guard";
import { appOrigin, menuUrl, qrSvg } from "../server/qr";
import { getQrSheetTables } from "../server/queries/tables";
import PrintSheetButton from "../components/tables/PrintSheetButton";

// /restaurant/qr-codes[?area=] — "Print all QR codes": an A4 sheet of every
// active table's menu code, three across, each labelled with the table and
// its area and cut along the dashed lines. Needs Manage Tables.
export default async function QrSheetPage({ searchParams }: { searchParams: Promise<{ area?: string }> }) {
  const denied = await guardPage(RESTAURANT_PERMISSIONS.MANAGE_TABLES);
  if (denied) return <div style={{ padding: 32 }}>{denied}</div>;

  const { area } = await searchParams;
  const [tables, origin] = await Promise.all([getQrSheetTables(area || undefined), appOrigin()]);
  // SVG made here from our own URL — safe to inline.
  const codes = await Promise.all(tables.map(async (table) => ({ ...table, svg: await qrSvg(menuUrl(origin, table.qrToken)) })));
  const scope = area && tables[0] ? tables[0].areaName : "All areas";

  return (
    <div style={{ padding: 32, display: "flex", flexDirection: "column", alignItems: "center", gap: 20 }}>
      <style>{`
        @page { size: A4; margin: 12mm; }
        .qr-code svg { width: 100%; height: 100%; display: block; }
        @media print {
          .no-print { display: none !important; }
          body, body > div { background: #fff !important; }
          .qr-sheet { width: auto !important; padding: 0 !important; box-shadow: none !important; }
        }
      `}</style>

      <div className="no-print" style={{ width: "210mm", display: "flex", alignItems: "center", gap: 12 }}>
        <Link href="/restaurant/tables" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13.5, fontWeight: 600, color: COLORS.slate, textDecoration: "none" }}>
          <ArrowLeft size={15} strokeWidth={1.7} />
          Tables
        </Link>
        <span style={{ marginLeft: 8, fontSize: 13.5, color: COLORS.slateMid }}>
          QR codes · {scope} · {codes.length} {codes.length === 1 ? "table" : "tables"}
        </span>
        <span style={{ marginLeft: "auto" }}>
          <PrintSheetButton />
        </span>
      </div>

      <div
        className="qr-sheet"
        aria-label="QR codes"
        style={{ width: "210mm", padding: "12mm", background: "#fff", boxShadow: "0 8px 28px -10px rgba(23,27,28,.25)" }}
      >
        {codes.length === 0 ? (
          <p style={{ margin: 0, fontSize: 14, color: COLORS.slateMid }}>No tables to print. Add tables first.</p>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "6mm" }}>
            {codes.map((code) => (
              <div
                key={code.id}
                data-qr-table={code.name}
                style={{
                  breakInside: "avoid",
                  border: `1px dashed ${COLORS.slateLight}`,
                  borderRadius: 10,
                  padding: "14px 12px 12px",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <div className="qr-code" style={{ width: 150, height: 150 }} dangerouslySetInnerHTML={{ __html: code.svg }} />
                <span style={{ fontFamily: FONTS.display, fontSize: 26, fontWeight: 600, lineHeight: 1.1, marginTop: 4 }}>{code.name}</span>
                <span style={{ fontSize: 13, color: COLORS.slate }}>{code.areaName}</span>
                <span style={{ fontSize: 11.5, color: COLORS.slateMid }}>Scan to see the menu</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
