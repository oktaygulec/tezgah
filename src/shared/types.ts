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
  /** Windows printer name for direct printing. Empty: print through the browser dialog. */
  printer_name: string;
  label_gap_mm: number;
  print_density: number;
  print_speed: number;
  print_offset_x_mm: number;
  print_offset_y_mm: number;
  print_rotate_180: boolean;
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
};

/** Settings that must be whole numbers. */
const INTEGER_SETTINGS: NumericSettingKey[] = ["print_density", "print_speed"];

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
