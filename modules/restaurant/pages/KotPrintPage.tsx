import { notFound } from "next/navigation";
import { formatAppDateTime } from "../lib/time";
import { RESTAURANT_PERMISSIONS } from "../manifest";
import { guardPage } from "../server/guard";
import { getKotForPrint } from "../server/queries/kds";
import KotPrintControls from "../components/kitchen/KotPrintControls";

// /restaurant/kot/[id][?autoprint=1] — a kitchen order ticket for an 80mm
// thermal printer: monospace, black on white. "Print KOT" on the kitchen
// display opens it with ?autoprint=1 (prints, then closes the tab).

const rule = { borderTop: "1px dashed #000", margin: "6px 0" } as const;
const row = { display: "flex", justifyContent: "space-between", gap: 8 } as const;

export default async function KotPrintPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ autoprint?: string }> }) {
  const denied = await guardPage(RESTAURANT_PERMISSIONS.KITCHEN_DISPLAY);
  if (denied) return denied;

  const [{ id }, { autoprint }] = await Promise.all([params, searchParams]);
  const kot = await getKotForPrint(id);
  if (!kot) notFound();
  const isVoid = kot.type === "VOID";

  return (
    <div style={{ padding: "24px 0", display: "flex", justifyContent: "center" }}>
      {/* Browsers drop "size: 80mm auto" (a length can't pair with auto), so
          the 80mm roll comes from the printer's paper setting — as for the
          POS receipt; margin: 0 applies, and the ticket is laid out 80mm wide. */}
      <style>{`
        @page { size: 80mm auto; margin: 0; }
        @media print {
          .no-print { display: none !important; }
          body, body > div, body > div > div { background: #fff !important; padding: 0 !important; }
          .kot { box-shadow: none !important; margin: 0 !important; }
        }
      `}</style>
      <article
        className="kot"
        aria-label={`${kot.ref}${isVoid ? " (void)" : ""}`}
        style={{ width: "80mm", padding: "4mm", background: "#fff", color: "#000", fontFamily: "'IBM Plex Mono', 'Courier New', monospace", fontSize: 13, lineHeight: 1.35, boxShadow: "0 4px 18px rgba(0,0,0,.18)" }}
      >
        <div style={{ textAlign: "center", fontWeight: 700, fontSize: 15, letterSpacing: ".08em", textTransform: "uppercase" }}>{kot.station}</div>
        {isVoid && (
          <div data-void style={{ margin: "6px 0", padding: "3px 0", background: "#000", color: "#fff", textAlign: "center", fontWeight: 700, fontSize: 18, letterSpacing: ".1em" }}>
            *** VOID ***
          </div>
        )}
        <div data-table style={{ textAlign: "center", fontWeight: 700, fontSize: 34, lineHeight: 1.1, margin: "4px 0" }}>
          {kot.table}
        </div>
        <div style={row}>
          <span style={{ fontWeight: 700 }}>{kot.ref}</span>
          <span>{kot.orderRef}</span>
        </div>
        <div style={row}>
          <span>{formatAppDateTime(kot.createdAt)}</span>
          <span>{kot.waiter}</span>
        </div>
        <div>{[kot.orderType, kot.area, `${kot.guests} ${kot.guests === 1 ? "guest" : "guests"}`].filter(Boolean).join(" · ")}</div>
        <KotPrintControls kotId={kot.id} printCount={kot.printCount} autoprint={autoprint === "1"} />
        <div style={rule} />
        {kot.note && <div style={{ fontWeight: 700, marginBottom: 4 }}>{kot.note}</div>}
        {kot.lines.map((line, i) => (
          <div key={i} data-kot-line style={{ marginBottom: 4 }}>
            <div style={{ display: "flex", gap: 8, fontWeight: 700, fontSize: 15 }}>
              <span style={{ minWidth: 28 }}>{line.quantity}x</span>
              <span style={{ flex: 1, textDecoration: isVoid ? "line-through" : "none" }}>{line.name}</span>
            </div>
            {line.modifiers && <div style={{ paddingLeft: 36 }}>+ {line.modifiers}</div>}
            {line.note && <div style={{ paddingLeft: 36 }}>» {line.note}</div>}
          </div>
        ))}
        <div style={rule} />
        <div style={{ ...row, fontWeight: 700 }}>
          <span>{isVoid ? "Items voided" : "Items"}</span>
          <span data-items>{kot.items}</span>
        </div>
      </article>
    </div>
  );
}
