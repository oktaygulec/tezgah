// Shapes shared by the API and the web app.

export interface Product {
  id: number;
  barcode: string;
  name: string;
  price_kurus: number;
  created_at: string;
  updated_at: string;
}

export interface ProductInput {
  barcode: string;
  name: string;
  price_kurus: number;
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
  quantity: number;
  line_total_kurus: number;
}

export interface OrderWithLines extends Order {
  lines: OrderLine[];
}

export interface NewOrderLine {
  product_id: number;
  quantity: number;
  /** The price the cashier saw; the server refuses the order when it differs. */
  unit_price_kurus: number;
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
};

export const SETTING_LABELS: Record<NumericSettingKey, string> = {
  label_width_mm: "Etiket genişliği (mm)",
  label_height_mm: "Etiket yüksekliği (mm)",
  label_margin_mm: "Kenar boşluğu (mm)",
  barcode_height_mm: "Barkod yüksekliği (mm)",
  name_font_pt: "Ürün adı yazı boyu (pt)",
  price_font_pt: "Fiyat yazı boyu (pt)",
  digits_font_pt: "Barkod rakamları yazı boyu (pt)",
};

/** Validates a settings object; returns a Turkish error text or null. */
export function validateSettings(s: Settings): string | null {
  if (typeof s.shop_name !== "string" || s.shop_name.trim().length > 100) return "Dükkan adı en fazla 100 karakter olabilir.";
  for (const [key, [min, max]] of Object.entries(SETTING_RANGES)) {
    const value = s[key as NumericSettingKey];
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
      return `${SETTING_LABELS[key as NumericSettingKey]}: ${min} ile ${max} arasında olmalı.`;
    }
  }
  if (typeof s.show_name !== "boolean" || typeof s.show_price !== "boolean") return "Göster seçenekleri hatalı.";
  return null;
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
