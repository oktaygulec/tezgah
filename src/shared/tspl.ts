// TSPL: the command language of TSC-compatible thermal label printers (Xprinter, TSC, many others).
// A label is sent as one 1-bit bitmap, so the printout matches the on-screen preview exactly.

export const DOTS_PER_MM = 8; // 203 dpi

export interface TsplSettings {
  widthMm: number;
  heightMm: number;
  gapMm: number;
  density: number; // 0-15
  speed: number; // inch per second
  rotate180: boolean;
}

export interface TsplLabel {
  /** Packed rows, 1 bit per dot, most significant bit first. A 0 bit prints a black dot. */
  bitmap: Uint8Array;
  width: number; // dots
  height: number; // dots
  copies: number;
}

export const bytesPerRow = (width: number) => Math.ceil(width / 8);

/**
 * Packs RGBA pixels (canvas ImageData) into TSPL bitmap rows.
 * Dark pixels (luminance below the threshold) become black dots.
 * In TSPL BITMAP data a 1 bit is white (no dot) and a 0 bit is black (dot).
 */
export function packMonochrome(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number, threshold = 160): Uint8Array {
  if (rgba.length !== width * height * 4) throw new Error(`Görüntü boyutu hatalı: ${rgba.length} != ${width}x${height}x4`);
  const rowBytes = bytesPerRow(width);
  const out = new Uint8Array(rowBytes * height).fill(0xff); // all white
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const alpha = rgba[i + 3]! / 255;
      // Transparent pixels count as white paper.
      const luminance = 255 - alpha * (255 - (0.299 * rgba[i]! + 0.587 * rgba[i + 1]! + 0.114 * rgba[i + 2]!));
      if (luminance < threshold) out[y * rowBytes + (x >> 3)]! &= ~(0x80 >> (x & 7));
    }
  }
  return out;
}

const ascii = (text: string) => new TextEncoder().encode(text);

/** Builds one print job: printer setup once, then CLS / BITMAP / PRINT for each label. */
export function buildTspl(settings: TsplSettings, labels: TsplLabel[]): Uint8Array {
  const parts: Uint8Array[] = [
    ascii(
      [
        `SIZE ${settings.widthMm} mm,${settings.heightMm} mm`,
        `GAP ${settings.gapMm} mm,0 mm`,
        `DIRECTION ${settings.rotate180 ? 0 : 1},0`,
        "REFERENCE 0,0",
        `SPEED ${settings.speed}`,
        `DENSITY ${settings.density}`,
        "SET TEAR ON",
        "",
      ].join("\r\n"),
    ),
  ];
  for (const label of labels) {
    const expected = bytesPerRow(label.width) * label.height;
    if (label.bitmap.length !== expected) {
      throw new Error(`Etiket görüntüsü hatalı: ${label.bitmap.length} bayt, ${expected} olmalı.`);
    }
    parts.push(ascii(`CLS\r\nBITMAP 0,0,${bytesPerRow(label.width)},${label.height},0,`));
    parts.push(label.bitmap);
    parts.push(ascii(`\r\nPRINT 1,${label.copies}\r\n`));
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}
