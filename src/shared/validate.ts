// Input rules shared by the web forms, the API and the CSV import. Messages are Turkish.
// Each function returns an error message, or null when the value is valid.

import { MAX_PRICE_KURUS, formatMoney, parseMoney } from "./money";

export const MAX_BARCODE_LENGTH = 64;
export const MAX_NAME_LENGTH = 200;

/** Printable ASCII without space: what scanners send and what Code 128 can print. */
const BARCODE_CHARS = /^[\x21-\x7e]+$/;
const CONTROL_CHARS = /[\x00-\x1f\x7f]/;

export function barcodeError(barcode: string): string | null {
  if (!barcode) return "Barkod boş olamaz.";
  if (/\s/.test(barcode)) return "Barkod boşluk içeremez.";
  if (barcode.length > MAX_BARCODE_LENGTH) return `Barkod en fazla ${MAX_BARCODE_LENGTH} karakter olabilir.`;
  if (!BARCODE_CHARS.test(barcode)) {
    return "Barkod yalnızca rakam, İngilizce harf ve - . / gibi işaretler içerebilir (Türkçe harf olamaz).";
  }
  return null;
}

export function nameError(name: string): string | null {
  if (!name) return "Ürün adı boş olamaz.";
  if (name.length > MAX_NAME_LENGTH) return `Ürün adı en fazla ${MAX_NAME_LENGTH} karakter olabilir (şu an ${name.length}).`;
  if (CONTROL_CHARS.test(name)) return "Ürün adında geçersiz karakter var.";
  return null;
}

/** Checks an amount in kuruş (from the API). */
export function priceKurusError(kurus: unknown): string | null {
  if (typeof kurus !== "number" || !Number.isSafeInteger(kurus)) return "Fiyat geçersiz.";
  if (kurus < 0) return "Fiyat eksi olamaz.";
  if (kurus > MAX_PRICE_KURUS) return `Fiyat en fazla ${formatMoney(MAX_PRICE_KURUS)} olabilir.`;
  return null;
}

/** Checks a purchase price in kuruş; null (not known) is allowed. */
export function costKurusError(kurus: unknown): string | null {
  if (kurus === null) return null;
  const error = priceKurusError(kurus);
  return error ? error.replace("Fiyat", "Alış fiyatı") : null;
}

/** Checks a purchase price typed by a person; an empty box means "not known". */
export function costTextError(text: string): string | null {
  if (text.trim() === "") return null;
  const error = priceTextError(text);
  return error ? error.replace("Fiyat", "Alış fiyatı") : null;
}

/** Checks a price typed by a person ("12,50", "12.50", "1.234,56"). */
export function priceTextError(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return "Fiyat boş olamaz.";
  if (trimmed.startsWith("-")) return "Fiyat eksi olamaz.";
  const kurus = parseMoney(trimmed);
  if (kurus === null) return "Fiyat anlaşılamadı. Örnek: 12,50";
  return priceKurusError(kurus);
}

/** Checks a helium price in kuruş (from the API). */
export function heliumKurusError(kurus: unknown): string | null {
  if (kurus === null || kurus === undefined) return "Helyumlu fiyat boş olamaz.";
  const error = priceKurusError(kurus);
  return error ? error.replace("Fiyat", "Helyumlu fiyat") : null;
}

/** Checks a helium price typed by a person. */
export function heliumTextError(text: string): string | null {
  const error = priceTextError(text);
  return error ? error.replace("Fiyat", "Helyumlu fiyat") : null;
}

export const MAX_CATEGORY_LENGTH = 60;

export function categoryNameError(name: string): string | null {
  if (!name) return "Kategori adı boş olamaz.";
  if (name.length > MAX_CATEGORY_LENGTH) return `Kategori adı en fazla ${MAX_CATEGORY_LENGTH} karakter olabilir.`;
  if (CONTROL_CHARS.test(name)) return "Kategori adında geçersiz karakter var.";
  return null;
}
