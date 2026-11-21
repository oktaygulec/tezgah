// Stock: whole pieces per product. Every change is stored as a movement, so the history explains the number.
// Stock may go below zero: a sale is never blocked, because the item is already in the customer's hand.

export type StockReason = "initial" | "receive" | "remove" | "count" | "sale" | "sale_cancel" | "import";

export const STOCK_REASON_LABELS: Record<StockReason, string> = {
  initial: "İlk stok",
  receive: "Stok girişi",
  remove: "Stok çıkışı",
  count: "Sayım",
  sale: "Satış",
  sale_cancel: "Satış iptali",
  import: "CSV aktarımı",
};

export interface StockMovement {
  id: number;
  product_id: number;
  change: number;
  stock_after: number;
  reason: StockReason;
  order_no: number | null;
  note: string;
  created_at: string;
}

/** add: goods came in; remove: goods went out (damage, loss); set: the counted amount. */
export type StockMode = "add" | "remove" | "set";

export const STOCK_MODE_LABELS: Record<StockMode, string> = {
  add: "Ekle (mal girişi)",
  remove: "Çıkar (bozuk, kayıp)",
  set: "Sayım sonucu (yeni değer)",
};

export const MAX_STOCK_QUANTITY = 1_000_000;
export const MAX_STOCK_NOTE_LENGTH = 200;

/** Checks a quantity for a mode. "set" allows 0; "add" and "remove" need at least 1. */
export function stockQuantityError(mode: StockMode, quantity: unknown): string | null {
  if (typeof quantity !== "number" || !Number.isFinite(quantity)) return "Miktar bir sayı olmalı.";
  if (!Number.isInteger(quantity)) return "Miktar tam sayı olmalı (adet).";
  const min = mode === "set" ? 0 : 1;
  if (quantity < min) return mode === "set" ? "Stok eksi olamaz." : "Miktar en az 1 olmalı.";
  if (quantity > MAX_STOCK_QUANTITY) return `Miktar en fazla ${MAX_STOCK_QUANTITY.toLocaleString("tr-TR")} olabilir.`;
  return null;
}

/** Parses a quantity typed by a person ("12"). Returns NaN for anything that is not a whole number. */
export function parseQuantity(text: string): number {
  const t = text.trim();
  return /^\d+$/.test(t) ? Number(t) : Number.NaN;
}

/** The change to the current stock for a mode and quantity. */
export function stockChange(current: number, mode: StockMode, quantity: number): number {
  if (mode === "add") return quantity;
  if (mode === "remove") return -quantity;
  return quantity - current;
}

export function stockNoteError(note: unknown): string | null {
  if (typeof note !== "string") return "Not geçersiz.";
  if (note.length > MAX_STOCK_NOTE_LENGTH) return `Not en fazla ${MAX_STOCK_NOTE_LENGTH} karakter olabilir.`;
  return null;
}
