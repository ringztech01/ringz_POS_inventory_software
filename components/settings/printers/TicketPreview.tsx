"use client";

import { useEffect, useMemo, useRef } from "react";
import { previewEscPos, type PreviewBlock } from "@/lib/hardware/escposPreview";
import { lineWidth } from "@/lib/hardware/escpos";
import { blackAt, type Raster } from "@/lib/hardware/raster";

// A ticket on screen as it comes out of the printer: its ESC/POS bytes read
// back (lib/hardware/escposPreview.ts) and drawn at the paper's width —
// 48 characters and 576 dots on 80 mm, 32 and 384 on 58 mm.

const DOTS = (paper: number) => (paper === 58 ? 384 : 576);

function Picture({ raster, paper }: { raster: Raster; paper: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    const img = ctx.createImageData(raster.width, raster.height);
    for (let y = 0; y < raster.height; y++) {
      for (let x = 0; x < raster.width; x++) {
        const i = (y * raster.width + x) * 4;
        const v = blackAt(raster, x, y) ? 0 : 255;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [raster]);
  const cols = lineWidth(paper);
  return (
    <canvas
      ref={canvas}
      width={raster.width}
      height={raster.height}
      style={{ width: `calc(${raster.width} * ${cols}ch / ${DOTS(paper)})`, imageRendering: "pixelated", display: "inline-block" }}
    />
  );
}

function Block({ block, paper }: { block: PreviewBlock; paper: number }) {
  if (block.kind === "cut") return <div data-preview-cut style={{ borderTop: "1px dashed #97a1a4", margin: "10px -12px 0", fontSize: 10, color: "#97a1a4", textAlign: "center" }}>✂ {block.partial ? "partial cut" : "cut"}</div>;
  if (block.kind === "drawer") return <div style={{ fontSize: 10, color: "#97a1a4", textAlign: "center" }}>[opens the cash drawer]</div>;
  if (block.kind === "image") return <div style={{ textAlign: block.align }}><Picture raster={block.raster} paper={paper} /></div>;
  const tall = Math.max(1, ...block.runs.map((r) => r.h));
  // Runs sit on the line's bottom; a taller one makes the whole line taller
  // (as on paper), so it never overlaps the line above.
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        justifyContent: block.align === "center" ? "center" : block.align === "right" ? "flex-end" : "flex-start",
        whiteSpace: "pre",
        height: `${1.25 * tall}em`,
        lineHeight: "1.25em",
      }}
    >
      {block.runs.map((r, i) =>
        r.w === 1 && r.h === 1 ? (
          <span key={i} style={{ fontWeight: r.bold ? 700 : 400 }}>
            {r.text}
          </span>
        ) : (
          // Double width / height: the characters scaled from the bottom
          // left, in a box the size they take on paper.
          <span key={i} style={{ position: "relative", display: "inline-block", width: `${r.text.length * r.w}ch`, height: `${1.25 * r.h}em`, fontWeight: r.bold ? 700 : 400 }}>
            <span style={{ position: "absolute", left: 0, bottom: 0, transform: `scale(${r.w}, ${r.h})`, transformOrigin: "left bottom" }}>{r.text}</span>
          </span>
        ),
      )}
    </div>
  );
}

export default function TicketPreview({ bytes, paper }: { bytes: Uint8Array; paper: number }) {
  const blocks = useMemo(() => previewEscPos(bytes), [bytes]);
  return (
    <div
      aria-label="Ticket preview"
      data-paper={paper}
      style={{ width: `calc(${lineWidth(paper)}ch + 24px)`, padding: "16px 12px 20px", background: "#fff", color: "#000", fontFamily: "'IBM Plex Mono', 'Courier New', monospace", fontSize: 12, boxShadow: "0 6px 22px -8px rgba(23,27,28,.35)", borderRadius: 4 }}
    >
      {blocks.map((block, i) => (
        <Block key={i} block={block} paper={paper} />
      ))}
    </div>
  );
}
