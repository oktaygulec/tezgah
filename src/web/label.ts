// Draws one product label in real millimetres. Used by the preview and the print view.

import JsBarcode from "jsbarcode";
import { detectBarcodeFormat, type BarcodeFormat } from "../shared/barcode";
import { formatMoney } from "../shared/money";
import type { Settings } from "../shared/types";
import { h } from "./ui";

const SVG_NS = "http://www.w3.org/2000/svg";
const DOT_MM = 25.4 / 203; // one dot of a 203 dpi printer ≈ 0.125 mm
const MIN_DOTS = 2; // narrowest bar = 2 dots ≈ 0.25 mm
const MAX_DOTS = 4;
const PT_MM = 25.4 / 72;
const MIN_FONT_PT = 4;

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
  el: HTMLElement;
  /** Turkish warnings for the preview (barcode too wide, text shrunk). */
  warnings: string[];
}

function drawBarcode(code: string, format: BarcodeFormat, heightUnits: number, fontUnits: number): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  const [left, right] = QUIET_ZONE[format];
  JsBarcode(svg, code, {
    format,
    width: 1, // 1 SVG unit = 1 module; the SVG is scaled to millimetres afterwards
    height: heightUnits,
    fontSize: fontUnits,
    textMargin: 1,
    margin: 0,
    marginLeft: left,
    marginRight: right,
    displayValue: true,
    font: "Arial, Helvetica, sans-serif",
    background: "#ffffff",
  });
  return svg;
}

export function renderLabel(product: LabelProduct, s: Settings): RenderedLabel {
  const warnings: string[] = [];
  const innerW = s.label_width_mm - 2 * s.label_margin_mm;
  const innerH = s.label_height_mm - 2 * s.label_margin_mm;
  const format = detectBarcodeFormat(product.barcode);

  // 1. Measure the barcode width in modules, then pick a whole number of printer dots per module.
  let svg: SVGSVGElement;
  try {
    svg = drawBarcode(product.barcode, format, 10, 10);
  } catch (e) {
    throw new Error(`Barkod çizilemedi (${product.barcode}): ${(e as Error).message ?? e}`);
  }
  const modules = Number(svg.getAttribute("width")!.replace("px", ""));
  const dots = Math.min(MAX_DOTS, Math.floor(innerW / modules / DOT_MM));
  const moduleMm = Math.max(MIN_DOTS, dots) * DOT_MM;
  if (dots < MIN_DOTS) {
    warnings.push(
      `Barkod etikete sığmıyor: ${(modules * MIN_DOTS * DOT_MM).toFixed(1)} mm genişlik gerekiyor, ${innerW.toFixed(1)} mm var.`,
    );
  }

  // 2. Draw it again with height and digit size given in modules.
  const digitsMm = s.digits_font_pt * PT_MM;
  svg = drawBarcode(product.barcode, format, s.barcode_height_mm / moduleMm, digitsMm / moduleMm);
  const unitsW = Number(svg.getAttribute("width")!.replace("px", ""));
  const unitsH = Number(svg.getAttribute("height")!.replace("px", ""));
  const barcodeHmm = unitsH * moduleMm;
  svg.setAttribute("width", `${unitsW * moduleMm}mm`);
  svg.setAttribute("height", `${barcodeHmm}mm`);
  svg.setAttribute("class", "label-barcode");
  svg.setAttribute("shape-rendering", "crispEdges"); // no blurred bar edges on the thermal printer

  // 3. Fit the text into the space that is left. Shrink text, never the bars.
  const gapMm = 0.5;
  const textSpace = Math.max(0, innerH - barcodeHmm - gapMm);
  let namePt = s.name_font_pt;
  let pricePt = s.price_font_pt;
  const needed = (s.show_name ? 2 * namePt * PT_MM * 1.15 : 0) + (s.show_price ? pricePt * PT_MM * 1.1 : 0);
  if (needed > textSpace) {
    const scale = textSpace / needed;
    namePt = Math.max(MIN_FONT_PT, namePt * scale);
    pricePt = Math.max(MIN_FONT_PT, pricePt * scale);
    warnings.push(
      textSpace < (s.show_name ? 2 * MIN_FONT_PT * PT_MM * 1.15 : 0) + (s.show_price ? MIN_FONT_PT * PT_MM * 1.1 : 0)
        ? "Yazılar için yer çok az. Barkod yüksekliğini azaltın veya etiketi büyütün."
        : "Yer az olduğu için yazılar küçültüldü.",
    );
  }
  if (barcodeHmm > innerH) warnings.push("Barkod etiketin yüksekliğine sığmıyor. Barkod yüksekliğini azaltın.");

  const el = h(
    "div",
    {
      class: "label",
      style: `width:${s.label_width_mm}mm;height:${s.label_height_mm}mm;padding:${s.label_margin_mm}mm`,
    },
    s.show_name &&
      h("div", { class: "label-name", style: `font-size:${namePt.toFixed(2)}pt` }, product.name),
    s.show_price &&
      h("div", { class: "label-price", style: `font-size:${pricePt.toFixed(2)}pt` }, formatMoney(product.price_kurus)),
    svg,
  );
  return { el, warnings };
}

/** Sets the printed page size to one label. */
export function setPageSize(s: Settings | null) {
  document.getElementById("label-page-size")?.remove();
  if (!s) return;
  const style = h("style", { id: "label-page-size" });
  style.textContent = `@page { size: ${s.label_width_mm}mm ${s.label_height_mm}mm; margin: 0; }`;
  document.head.append(style);
}
