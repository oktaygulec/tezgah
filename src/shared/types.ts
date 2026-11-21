// Shapes shared by the API and the web app.

import type { BucketDef, Period } from "./report";

export interface Product {
  id: number;
  barcode: string;
  name: string;
  price_kurus: number;
  /** Pieces in stock. Can be below zero when more was sold than recorded. */
  stock_qty: number;
  /** Purchase price (alış fiyatı). Null when not entered. */
  cost_kurus: number | null;
  /** Category; null = no category. */
  category_id: number | null;
  /** Second sale price "with helium". Set only for products in a category with helium pricing. */
  helium_price_kurus: number | null;
  /** 1 = shown in the "Ürün seç" dialog of Satış. */
  favorite: 0 | 1;
  /** Time of the last photo change; null = no photo. Also used to refresh the cached photo. */
  image_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Category {
  id: number;
  name: string;
  /** 1 = products have two sale prices: empty and with helium (balloons). */
  helium_pricing: 0 | 1;
  /** Number of products in the category. */
  product_count: number;
}

export interface CategoryInput {
  name: string;
  helium_pricing: boolean;
}

/** URL of the product photo, or null when the product has none. */
export function productImageUrl(p: { id: number; image_at: string | null }): string | null {
  return p.image_at ? `/api/products/${p.id}/image?v=${encodeURIComponent(p.image_at)}` : null;
}

/** The sale price of a product, empty or with helium. */
export function salePrice(p: { price_kurus: number; helium_price_kurus: number | null }, helium: boolean): number {
  return helium && p.helium_price_kurus !== null ? p.helium_price_kurus : p.price_kurus;
}

export interface ProductInput {
  barcode: string;
  name: string;
  price_kurus: number;
  /** Purchase price; null or missing = not known. */
  cost_kurus?: number | null;
  category_id?: number | null;
  /** Required when the category has helium pricing; must be null otherwise. */
  helium_price_kurus?: number | null;
  favorite?: boolean;
}

export interface Order {
  id: number;
  order_no: number;
  total_kurus: number;
  created_at: string;
  /** Set when the order was cancelled after it was saved. */
  cancelled_at: string | null;
  line_count: number;
}

export interface OrderLine {
  id: number;
  order_id: number;
  product_id: number;
  barcode: string;
  name: string;
  unit_price_kurus: number;
  /** Purchase price at the time of sale; null when it was not known. */
  unit_cost_kurus: number | null;
  quantity: number;
  line_total_kurus: number;
  /** 1 = sold with helium (at the helium price). */
  helium: 0 | 1;
}

export interface OrderWithLines extends Order {
  lines: OrderLine[];
}

export interface NewOrderLine {
  product_id: number;
  quantity: number;
  /** The price the cashier saw; the server refuses the order when it differs. */
  unit_price_kurus: number;
  /** Sold with helium, at the helium price. */
  helium?: boolean;
}

export interface ImportResult {
  added: number;
  updated: number;
  failed: { line: number; text: string; reason: string }[];
}

export interface Settings {
  shop_name: string;
  label_width_mm: number;
  label_height_mm: number;
  label_margin_mm: number;
  show_name: boolean;
  show_price: boolean;
  barcode_height_mm: number;
  name_font_pt: number;
  price_font_pt: number;
  digits_font_pt: number;
  /** Windows printer name for direct printing. Empty: print through the browser dialog. */
  printer_name: string;
  label_gap_mm: number;
  print_density: number;
  print_speed: number;
  print_offset_x_mm: number;
  print_offset_y_mm: number;
  print_rotate_180: boolean;
  /** Products with this stock or less are listed in Azalan Stok. */
  low_stock_threshold: number;
}

export const DEFAULT_SETTINGS: Settings = {
  shop_name: "Tezgah",
  label_width_mm: 40,
  label_height_mm: 30,
  label_margin_mm: 1.5,
  show_name: true,
  show_price: true,
  barcode_height_mm: 10,
  name_font_pt: 8,
  price_font_pt: 16,
  digits_font_pt: 7,
  printer_name: "",
  label_gap_mm: 2,
  print_density: 8,
  print_speed: 4,
  print_offset_x_mm: 0,
  print_offset_y_mm: 0,
  print_rotate_180: false,
  low_stock_threshold: 5,
};

export type NumericSettingKey = { [K in keyof Settings]: Settings[K] extends number ? K : never }[keyof Settings];

/** Allowed range for each numeric setting: [min, max]. */
export const SETTING_RANGES: Record<NumericSettingKey, [number, number]> = {
  label_width_mm: [15, 120],
  label_height_mm: [10, 120],
  label_margin_mm: [0, 10],
  barcode_height_mm: [3, 60],
  name_font_pt: [4, 30],
  price_font_pt: [4, 60],
  digits_font_pt: [4, 20],
  label_gap_mm: [0, 20],
  print_density: [0, 15],
  print_speed: [1, 6],
  print_offset_x_mm: [-10, 10],
  print_offset_y_mm: [-10, 10],
  low_stock_threshold: [0, 100000],
};

/** Settings that must be whole numbers. */
const INTEGER_SETTINGS: NumericSettingKey[] = ["print_density", "print_speed", "low_stock_threshold"];

export const SETTING_LABELS: Record<NumericSettingKey, string> = {
  label_width_mm: "Etiket genişliği (mm)",
  label_height_mm: "Etiket yüksekliği (mm)",
  label_margin_mm: "Kenar boşluğu (mm)",
  barcode_height_mm: "Barkod yüksekliği (mm)",
  name_font_pt: "Ürün adı yazı boyu (pt)",
  price_font_pt: "Fiyat yazı boyu (pt)",
  digits_font_pt: "Barkod rakamları yazı boyu (pt)",
  label_gap_mm: "Etiketler arası boşluk (mm)",
  print_density: "Baskı koyuluğu (0-15)",
  print_speed: "Baskı hızı (1-6)",
  print_offset_x_mm: "Sağa kaydır (mm)",
  print_offset_y_mm: "Aşağı kaydır (mm)",
  low_stock_threshold: "Azalan stok sınırı (adet)",
};

/** Validates a settings object; returns a Turkish error text or null. */
export type SettingsErrors = Partial<Record<keyof Settings, string>>;

/** Checks every setting; returns one Turkish message per invalid field. */
export function settingsErrors(s: Settings): SettingsErrors {
  const errors: SettingsErrors = {};
  if (typeof s.shop_name !== "string" || s.shop_name.trim().length > 100) errors.shop_name = "Dükkan adı en fazla 100 karakter olabilir.";
  for (const [key, [min, max]] of Object.entries(SETTING_RANGES) as [NumericSettingKey, [number, number]][]) {
    const value = s[key];
    if (typeof value !== "number" || !Number.isFinite(value)) errors[key] = `${SETTING_LABELS[key]}: bir sayı yazın.`;
    else if (value < min || value > max) errors[key] = `${SETTING_LABELS[key]}: ${min} ile ${max} arasında olmalı.`;
    else if (INTEGER_SETTINGS.includes(key) && !Number.isInteger(value)) errors[key] = `${SETTING_LABELS[key]}: tam sayı olmalı.`;
  }
  // Fields that depend on each other.
  if (!errors.label_margin_mm && !errors.label_width_mm && !errors.label_height_mm) {
    const smaller = Math.min(s.label_width_mm, s.label_height_mm);
    if (s.label_margin_mm * 2 >= smaller) errors.label_margin_mm = `${SETTING_LABELS.label_margin_mm}: etiket için çok büyük.`;
  }
  if (!errors.barcode_height_mm && !errors.label_margin_mm && !errors.label_height_mm) {
    if (s.barcode_height_mm >= s.label_height_mm - 2 * s.label_margin_mm) {
      errors.barcode_height_mm = `${SETTING_LABELS.barcode_height_mm}: etiketin iç yüksekliğinden küçük olmalı.`;
    }
  }
  for (const key of ["show_name", "show_price", "print_rotate_180"] as const) {
    if (typeof s[key] !== "boolean") errors[key] = "Seçenek değeri hatalı.";
  }
  if (typeof s.printer_name !== "string" || s.printer_name.length > 200) errors.printer_name = "Yazıcı adı hatalı.";
  return errors;
}

/** The first settings error, or null when all settings are valid. */
export function validateSettings(s: Settings): string | null {
  return Object.values(settingsErrors(s))[0] ?? null;
}

export interface PrintLabelInput {
  /** Base64 of the packed TSPL bitmap (see shared/tspl.ts). */
  bitmap: string;
  width: number;
  height: number;
  copies: number;
}

export interface PrinterList {
  printers: string[];
  default: string | null;
}

export interface UpdateInfo {
  current: string;
  latest: string;
  available: boolean;
  notes: string;
  url: string;
}

export interface HealthResponse {
  app: "tezgah";
  ok: true;
  version: string;
}

// ---------- reports ----------

export interface ReportTotals {
  revenue_kurus: number;
  /** Purchase cost of the lines whose purchase price was known. */
  cost_kurus: number;
  /** Gross profit of the lines whose purchase price was known. */
  profit_kurus: number;
  /** Revenue of lines sold without a known purchase price (not in the profit). */
  unknown_cost_revenue_kurus: number;
  orders: number;
  pieces: number;
  cancelled_orders: number;
  cancelled_kurus: number;
}

export interface ReportBucket extends BucketDef {
  revenue_kurus: number;
  profit_kurus: number;
  orders: number;
  pieces: number;
}

export interface TopProduct {
  product_id: number;
  name: string;
  barcode: string;
  pieces: number;
  revenue_kurus: number;
  profit_kurus: number;
  /** True when some of these sales had no known purchase price. */
  unknown_cost: boolean;
}

export interface SalesReport {
  period: Period;
  previous: Period;
  totals: ReportTotals;
  previous_totals: ReportTotals;
  buckets: ReportBucket[];
  /** Every product sold in the period, most pieces first. */
  products: TopProduct[];
  /** Products in stock that sold nothing in the period (up to 50, highest stock value first). */
  unsold: { product_id: number; name: string; barcode: string; stock_qty: number; cost_kurus: number | null; price_kurus: number }[];
  /** Current stock value (not tied to the period). */
  stock: { pieces: number; cost_value_kurus: number; sale_value_kurus: number; products_without_cost: number };
}

export interface LowStockItem extends Product {
  sold_30d: number;
}

/** One bulk price change (Toplu Fiyat), kept so that it can be undone. */
export interface PriceBatch {
  id: number;
  description: string;
  created_at: string;
  /** Set when the change was undone. */
  undone_at: string | null;
  /** Number of products whose prices changed. */
  product_count: number;
}

export interface PriceBatchResult {
  batch: PriceBatch;
  /** Products whose prices changed (for printing new labels). */
  product_ids: number[];
}

export interface PriceUndoResult {
  /** Prices set back to the old value. */
  restored: number;
  /** Prices left as they are, because they were changed again after the bulk change. */
  skipped: number;
  product_ids: number[];
}
