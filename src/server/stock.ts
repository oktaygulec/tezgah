// User-facing stock operations: adjust one product, receive many products, read the history.

import type { Database } from "bun:sqlite";
import { stockChange, stockNoteError, stockQuantityError, type StockMode, type StockMovement } from "../shared/stock";
import type { Product } from "../shared/types";
import { applyStockChange, HttpError } from "./db";

const MODE_REASON = { add: "receive", remove: "remove", set: "count" } as const;

function readNote(note: unknown): string {
  const value = note ?? "";
  const error = stockNoteError(value);
  if (error) throw new HttpError(400, error);
  return (value as string).trim();
}

function getProduct(db: Database, id: number): Product {
  const product = db.query("SELECT * FROM products WHERE id = ?").get(id) as Product | null;
  if (!product) throw new HttpError(404, "Ürün bulunamadı.");
  return product;
}

/** Adds, removes or sets the stock of one product. */
export function adjustStock(db: Database, productId: number, input: unknown): Product {
  const body = (input ?? {}) as { mode?: unknown; quantity?: unknown; note?: unknown };
  const mode = body.mode as StockMode;
  if (!(mode in MODE_REASON)) throw new HttpError(400, "Stok işlemi geçersiz.");
  const error = stockQuantityError(mode, body.quantity);
  if (error) throw new HttpError(400, error);
  const note = readNote(body.note);
  return db.transaction(() => {
    const product = getProduct(db, productId);
    const change = stockChange(product.stock_qty, mode, body.quantity as number);
    // A count that matches the stock is still recorded: it shows when the stock was last checked.
    product.stock_qty = applyStockChange(db, productId, change, MODE_REASON[mode], { note });
    return product;
  })();
}

/** Goods in: adds the scanned quantities to stock in one transaction. */
export function receiveStock(db: Database, input: unknown): { products: number; pieces: number } {
  const body = (input ?? {}) as { lines?: unknown; note?: unknown };
  if (!Array.isArray(body.lines) || body.lines.length === 0) throw new HttpError(400, "Stok girişi boş.");
  const note = readNote(body.note);
  const lines = body.lines as { product_id?: unknown; quantity?: unknown }[];
  for (const l of lines) {
    if (!Number.isSafeInteger(l?.product_id)) throw new HttpError(400, "Stok girişi satırı geçersiz.");
    const error = stockQuantityError("add", l.quantity);
    if (error) throw new HttpError(400, error);
  }
  return db.transaction(() => {
    let pieces = 0;
    for (const l of lines) {
      const product = db.query("SELECT id FROM products WHERE id = ?").get(l.product_id as number);
      if (!product) throw new HttpError(409, "Listedeki bir ürün artık kayıtlı değil. Satırı silip tekrar okutun.");
      applyStockChange(db, l.product_id as number, l.quantity as number, "receive", { note });
      pieces += l.quantity as number;
    }
    return { products: lines.length, pieces };
  })();
}

/** The newest movements of one product. */
export function listMovements(db: Database, productId: number, limit = 100): StockMovement[] {
  getProduct(db, productId);
  return db
    .query("SELECT * FROM stock_movements WHERE product_id = ? ORDER BY id DESC LIMIT ?")
    .all(productId, limit) as StockMovement[];
}
