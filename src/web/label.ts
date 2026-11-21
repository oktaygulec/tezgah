// Draws one product label as a black-and-white image at the printer's resolution (203 dpi).
// The same image is the on-screen preview, the direct (TSPL) print data, and the browser print fallback.

import JsBarcode from "jsbarcode";
import { detectBarcodeFormat, type BarcodeFormat } from "../shared/barcode";
import { formatMoney } from "../shared/money";
import { DOTS_PER_MM, packMonochrome } from "../shared/tspl";
import type { PrintLabelInput, Settings } from "../shared/types";
import { h } from "./ui";

const DOTS_PER_PT = (DOTS_PER_MM * 25.4) / 72; // ≈ 2.82
const MIN_MODULE = 2; // narrowest bar: 2 dots = 0.25 mm
const MAX_MODULE = 4;
const MIN_FONT_PT = 4;
const FONT = "Arial, Helvetica, sans-serif";
const THRESHOLD = 160;

/** Quiet zones in modules. EAN-13 already draws 12 blank modules on its left for the first digit. */
const QUIET_ZONE: Record<BarcodeFormat, [number, number]> = {
  EAN13: [0, 7],
  EAN8: [7, 7],
  CODE128: [10, 10],
};

export interface LabelProduct {
  barcode: string;
  name: string;
  price_kurus: number;
}

export interface RenderedLabel {
  canvas: HTMLCanvasElement;
  /** Turkish warnings for the preview (barcode too wide, text shrunk). */
  warnings: string[];
}

function drawBarcode(code: string, format: BarcodeFormat, module: number, heightDots: number, fontDots: number, text: boolean) {
  const canvas = document.createElement("canvas");
  const [left, right] = QUIET_ZONE[format];
  try {
    JsBarcode(canvas, code, {
      format,
      width: module,
      height: heightDots,
      fontSize: fontDots,
      textMargin: 2,
      margin: 0,
      marginLeft: left * module,
      marginRight: right * module,
      displayValue: text,
      font: FONT,
      background: "#ffffff",
    });
  } catch (e) {
    throw new Error(`Barkod çizilemedi (${code}): ${(e as Error).message ?? e}`);
  }
  return canvas;
}

/** Splits text into at most `maxLines` lines that fit `maxWidth`; the last line ends with "…" if cut. */
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const fits = (t: string) => ctx.measureText(t).width <= maxWidth;
  const lines: string[] = [];
  let rest = text.trim().split(/\s+/);
  while (rest.length && lines.length < maxLines) {
    let line = rest[0]!;
    let used = 1;
    while (used < rest.length && fits(`${line} ${rest[used]}`)) line += ` ${rest[used++]}`;
    rest = rest.slice(used);
    if (lines.length === maxLines - 1 && (rest.length || !fits(line))) {
      // last allowed line: cut and add an ellipsis
      let cut = rest.length ? `${line} ${rest.join(" ")}` : line;
      while (cut.length > 1 && !fits(`${cut}…`)) cut = cut.slice(0, -1);
      line = `${cut.trimEnd()}…`;
      rest = [];
    } else if (!fits(line)) {
      // one word wider than the label: cut it by characters
      let cut = line;
      while (cut.length > 1 && !fits(cut)) cut = cut.slice(0, -1);
      rest = [line.slice(cut.length), ...rest];
      line = cut;
    }
    lines.push(line);
  }
  return lines;
}

export function renderLabel(product: LabelProduct, s: Settings): RenderedLabel {
  const warnings: string[] = [];
  const width = Math.round(s.label_width_mm * DOTS_PER_MM);
  const height = Math.round(s.label_height_mm * DOTS_PER_MM);
  const margin = Math.round(s.label_margin_mm * DOTS_PER_MM);
  const innerW = width - 2 * margin;
  const innerH = height - 2 * margin;
  const format = detectBarcodeFormat(product.barcode);

  // 1. Barcode: measure the width in modules, then use the widest whole number of dots per module that fits.
  const modules = drawBarcode(product.barcode, format, 1, 10, 10, false).width;
  const fit = Math.floor(innerW / modules);
  const module = Math.min(MAX_MODULE, Math.max(MIN_MODULE, fit));
  if (fit < MIN_MODULE) {
    warnings.push(`Barkod etikete sığmıyor: ${((modules * MIN_MODULE) / DOTS_PER_MM).toFixed(1)} mm genişlik gerekiyor, ${(innerW / DOTS_PER_MM).toFixed(1)} mm var.`);
  }
  const barcode = drawBarcode(
    product.barcode,
    format,
    module,
    Math.round(s.barcode_height_mm * DOTS_PER_MM),
    Math.round(s.digits_font_pt * DOTS_PER_PT),
    true,
  );
  if (barcode.height > innerH) warnings.push("Barkod etiketin yüksekliğine sığmıyor. Barkod yüksekliğini azaltın.");

  // 2. Text: shrink the fonts (never the bars) when there is not enough room above the barcode.
  const gap = 4;
  const textSpace = Math.max(0, innerH - barcode.height - gap);
  let namePx = s.name_font_pt * DOTS_PER_PT;
  let pricePx = s.price_font_pt * DOTS_PER_PT;
  const needed = (s.show_name ? 2 * namePx * 1.15 : 0) + (s.show_price ? pricePx * 1.1 : 0);
  if (needed > textSpace) {
    const scale = textSpace / needed;
    const minPx = MIN_FONT_PT * DOTS_PER_PT;
    namePx = Math.max(minPx, namePx * scale);
    pricePx = Math.max(minPx, pricePx * scale);
    const minNeeded = (s.show_name ? 2 * minPx * 1.15 : 0) + (s.show_price ? minPx * 1.1 : 0);
    warnings.push(
      textSpace < minNeeded
        ? "Yazılar için yer çok az. Barkod yüksekliğini azaltın veya etiketi büyütün."
        : "Yer az olduğu için yazılar küçültüldü.",
    );
  }

  // 3. Draw.
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.translate(Math.round(s.print_offset_x_mm * DOTS_PER_MM), Math.round(s.print_offset_y_mm * DOTS_PER_MM));
  ctx.fillStyle = "#000";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const centerX = width / 2;
  const barcodeTop = height - margin - barcode.height;

  let y = margin;
  if (s.show_name) {
    ctx.font = `bold ${namePx}px ${FONT}`;
    for (const line of wrapText(ctx, product.name, innerW, 2)) {
      ctx.fillText(line, centerX, y);
      y += namePx * 1.15;
    }
  }
  if (s.show_price) {
    ctx.font = `bold ${pricePx}px ${FONT}`;
    // Centre the price in the space between the name and the barcode.
    const free = barcodeTop - gap - y;
    ctx.fillText(formatMoney(product.price_kurus), centerX, y + Math.max(0, (free - pricePx) / 2));
  }
  ctx.drawImage(barcode, Math.round((width - barcode.width) / 2), barcodeTop);

  // 4. Make it pure black and white, exactly as the thermal printer will print it.
  const image = ctx.getImageData(0, 0, width, height);
  const px = image.data;
  for (let i = 0; i < px.length; i += 4) {
    const v = 0.299 * px[i]! + 0.587 * px[i + 1]! + 0.114 * px[i + 2]! < THRESHOLD ? 0 : 255;
    px[i] = px[i + 1] = px[i + 2] = v;
    px[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return { canvas, warnings };
}

/** The label as print data for /api/print. */
export function toPrintLabel(label: RenderedLabel, copies: number): PrintLabelInput {
  const { canvas } = label;
  const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
  const bits = packMonochrome(pixels, canvas.width, canvas.height, THRESHOLD);
  let binary = "";
  for (let i = 0; i < bits.length; i += 0x8000) binary += String.fromCharCode(...bits.subarray(i, i + 0x8000));
  return { bitmap: btoa(binary), width: canvas.width, height: canvas.height, copies };
}

/** Shows the label at its real size on screen. */
export function labelElement(label: RenderedLabel, s: Settings): HTMLElement {
  const img = h("img", { class: "label", src: label.canvas.toDataURL("image/png"), alt: "Etiket" });
  img.style.width = `${s.label_width_mm}mm`;
  img.style.height = `${s.label_height_mm}mm`;
  return img;
}

/** Sets the printed page size to one label (browser printing only). */
export function setPageSize(s: Settings | null) {
  document.getElementById("label-page-size")?.remove();
  if (!s) return;
  const style = h("style", { id: "label-page-size" });
  style.textContent = `@page { size: ${s.label_width_mm}mm ${s.label_height_mm}mm; margin: 0; }`;
  document.head.append(style);
}
