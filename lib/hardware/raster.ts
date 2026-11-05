import QRCode from "qrcode";

// 1-bit images for thermal printers: the logo (turned to black and white
// once, in the browser — any image it can show — and kept in the settings)
// and QR codes (drawn from their module grid, so they print on any ESC/POS
// printer, not only those with a QR command). Pure.

// Rows of `width` dots, each row ceil(width / 8) bytes, 1 = black.
export type Raster = { width: number; height: number; data: Uint8Array };

// Logos are kept at most this wide: it fits 58 mm paper (384 dots) and 80 mm.
export const LOGO_MAX_WIDTH = 384;
export const LOGO_MAX_HEIGHT = 240;

export const rowBytes = (width: number) => Math.ceil(width / 8);

export function blackAt(r: Raster, x: number, y: number): boolean {
  return (r.data[y * rowBytes(r.width) + (x >> 3)] & (0x80 >> (x & 7))) !== 0;
}

// RGBA pixels (a canvas' ImageData) → 1 bit per dot, Floyd–Steinberg
// dithered; transparent counts as white.
export function toRaster(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number, threshold = 128): Raster {
  const lum = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const a = rgba[i * 4 + 3] / 255;
    const y = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
    lum[i] = y * a + 255 * (1 - a);
  }
  const bytes = rowBytes(width);
  const data = new Uint8Array(bytes * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const black = lum[i] < threshold;
      if (black) data[y * bytes + (x >> 3)] |= 0x80 >> (x & 7);
      const err = lum[i] - (black ? 0 : 255);
      if (x + 1 < width) lum[i + 1] += (err * 7) / 16;
      if (y + 1 < height) {
        if (x > 0) lum[i + width - 1] += (err * 3) / 16;
        lum[i + width] += (err * 5) / 16;
        if (x + 1 < width) lum[i + width + 1] += err / 16;
      }
    }
  }
  return { width, height, data };
}

// GS v 0: the image, in bands of at most 128 rows (some printers' buffers).
export function rasterCommand(r: Raster): number[] {
  const bytes = rowBytes(r.width);
  const out: number[] = [];
  for (let top = 0; top < r.height; top += 128) {
    const rows = Math.min(128, r.height - top);
    out.push(0x1d, 0x76, 0x30, 0, bytes & 0xff, bytes >> 8, rows & 0xff, rows >> 8);
    for (let i = top * bytes; i < (top + rows) * bytes; i++) out.push(r.data[i]);
  }
  return out;
}

// A QR code of `text`, `dots` per module, with a 2-module quiet zone.
export function qrRaster(text: string, dots = 6): Raster {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const size = qr.modules.size;
  const quiet = 2;
  const width = (size + quiet * 2) * dots;
  const bytes = rowBytes(width);
  const data = new Uint8Array(bytes * width);
  for (let my = 0; my < size; my++) {
    for (let mx = 0; mx < size; mx++) {
      if (!qr.modules.get(my, mx)) continue;
      for (let dy = 0; dy < dots; dy++) {
        const y = (my + quiet) * dots + dy;
        for (let dx = 0; dx < dots; dx++) {
          const x = (mx + quiet) * dots + dx;
          data[y * bytes + (x >> 3)] |= 0x80 >> (x & 7);
        }
      }
    }
  }
  return { width, height: width, data };
}
