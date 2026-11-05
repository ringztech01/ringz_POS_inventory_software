// The printers' character tables: what bytes 0x80–0xFF print as, per ESC/POS
// code page — used both to encode text for the printer and to decode it for
// the on-screen preview. PC437 / PC850 / PC858 are spelled out (no platform
// decoder has them); WPC1252 and PC866 come from TextDecoder. Pages without a
// table here print their ASCII, and "?" for the rest.

const PC437 =
  "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ";
const PC850 =
  "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´­±‗¾¶§÷¸°¨·¹³²■ ";
// PC858 is PC850 with the euro sign in place of the dotless i (0xD5).
const PC858 = PC850.slice(0, 0x55) + "€" + PC850.slice(0x56);

function fromDecoder(label: string): string | null {
  try {
    const decoder = new TextDecoder(label);
    return decoder.decode(Uint8Array.from({ length: 128 }, (_, i) => 0x80 + i));
  } catch {
    return null;
  }
}

const HIGH_HALF: Partial<Record<string, string | null>> = {
  PC437,
  PC850,
  PC858,
  WPC1252: fromDecoder("windows-1252"),
  PC866: fromDecoder("ibm866"),
};

const encoders = new Map<string, Map<string, number>>();

// Character → byte for a code page (ASCII left to the caller).
export function encoderFor(codePage: string): Map<string, number> {
  let map = encoders.get(codePage);
  if (!map) {
    map = new Map();
    const high = HIGH_HALF[codePage];
    if (high && high.length === 128) {
      [...high].forEach((ch, i) => {
        if (ch !== "�" && !map!.has(ch)) map!.set(ch, 0x80 + i);
      });
    }
    encoders.set(codePage, map);
  }
  return map;
}

// Byte → character, for the preview.
export function decodeByte(byte: number, codePage: string): string {
  if (byte < 0x80) return String.fromCharCode(byte);
  const high = HIGH_HALF[codePage];
  return high && high.length === 128 ? [...high][byte - 0x80] : "?";
}
