import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { REPORTS } from "@/lib/hardware/assignments";
import { COLORS } from "@/components/layout/theme";
import { idSchema } from "../schemas/common";
import { guardMenuQrPage } from "../server/guard";
import { buildMenuCards, type BuiltCard, type CardSelection } from "../server/queries/menuQr";
import PrintSheetButton from "../components/tables/PrintSheetButton";

// /restaurant/menu-cards?table=<id> | ?point=<id> | ?all=1 — the menu's QR
// cards to print (Part 8 Step 2): one A6 card on its own page, or four to
// each A4 sheet with cut lines. Printed through the system dialog (the
// Reports printer, Part 6d, is an OS printer). The Administrator or Manage
// Floor Plan.
export default async function MenuCardsPrintPage({ searchParams }: { searchParams: Promise<{ table?: string; point?: string; all?: string }> }) {
  await guardMenuQrPage();
  const params = await searchParams;
  const table = idSchema.safeParse(params.table);
  const point = idSchema.safeParse(params.point);
  const selection: CardSelection | null =
    params.all === "1" ? { all: true } : table.success ? { kind: "table", id: table.data } : point.success ? { kind: "point", id: point.data } : null;
  const [cards, reportsPrinter] = await Promise.all([
    selection ? buildMenuCards(selection) : Promise.resolve<BuiltCard[]>([]),
    prisma.printerAssignment.findFirst({ where: { role: REPORTS, printer: { deletedAt: null } }, select: { printer: { select: { name: true } } } }),
  ]);

  const back = (
    <Link href="/restaurant/digital-menu/qr-codes" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13.5, fontWeight: 600, color: COLORS.slate, textDecoration: "none" }}>
      <ArrowLeft size={15} strokeWidth={1.7} />
      QR codes
    </Link>
  );
  if (cards === null || cards.length === 0) {
    return (
      <div style={{ padding: 32, display: "flex", flexDirection: "column", gap: 14, alignItems: "flex-start" }}>
        {back}
        <p data-menu-cards-empty style={{ margin: 0, fontSize: 14, color: COLORS.slateMid }}>
          {cards === null ? "Save the menu's address on the QR codes page first: the cards need it." : "There's no card to print: the table or point may have been removed."}
        </p>
      </div>
    );
  }

  const single = cards.length === 1;
  const sheets: BuiltCard[][] = [];
  for (let i = 0; i < cards.length; i += 4) sheets.push(cards.slice(i, i + 4));
  const shadow = "0 8px 28px -10px rgba(23,27,28,.25)";

  return (
    <div style={{ padding: 32, display: "flex", flexDirection: "column", alignItems: "center", gap: 20 }}>
      <style>{`
        @page { size: ${single ? "A6" : "A4"}; margin: 0; }
        .menu-card svg { display: block; width: 105mm; height: 148mm; }
        @media print {
          .no-print { display: none !important; }
          body, body > div { background: #fff !important; padding: 0 !important; gap: 0 !important; }
          .menu-sheet { box-shadow: none !important; }
        }
      `}</style>
      <div className="no-print" style={{ width: single ? 420 : "210mm", display: "flex", alignItems: "center", gap: 12 }}>
        {back}
        <span data-menu-cards-count style={{ fontSize: 13, color: COLORS.slateMid }}>
          {single ? cards[0].title : `${cards.length} cards · ${sheets.length} A4 ${sheets.length === 1 ? "sheet" : "sheets"}`}
          {reportsPrinter ? ` · print on “${reportsPrinter.printer.name}”` : ""}
        </span>
        <span style={{ marginLeft: "auto" }}>
          <PrintSheetButton />
        </span>
      </div>
      {single ? (
        <div className="menu-sheet menu-card" data-menu-card={cards[0].title} style={{ boxShadow: shadow }} dangerouslySetInnerHTML={{ __html: cards[0].svg }} />
      ) : (
        sheets.map((sheet, i) => (
          <div
            key={i}
            className="menu-sheet"
            data-menu-sheet={i + 1}
            style={{ width: "210mm", height: "296mm", background: "#fff", display: "grid", gridTemplateColumns: "105mm 105mm", gridTemplateRows: "148mm 148mm", breakAfter: i < sheets.length - 1 ? "page" : "auto", boxShadow: shadow }}
          >
            {sheet.map((c, k) => (
              // Cut lines: dashed between the cards.
              <div
                key={c.key}
                className="menu-card"
                data-menu-card={c.title}
                style={{ borderRight: k % 2 === 0 ? "1px dashed #b8c0c2" : undefined, borderBottom: k < 2 ? "1px dashed #b8c0c2" : undefined, overflow: "hidden" }}
                dangerouslySetInnerHTML={{ __html: c.svg }}
              />
            ))}
          </div>
        ))
      )}
    </div>
  );
}
