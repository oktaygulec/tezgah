// Toplu Fiyat: saves many price changes at once, and undoes such a change.

import type { Database } from "bun:sqlite";
import { PRICE_FIELDS, type PriceChange, type PriceField } from "../shared/bulkPrice";
import type { PriceBatch, PriceBatchResult, PriceUndoResult } from "../shared/types";
import { costKurusError, heliumKurusError, priceKurusError } from "../shared/validate";
import { HttpError } from "./db";

export const MAX_PRICE_CHANGES = 30000;
export const MAX_DESCRIPTION_LENGTH = 300;

const FIELD_ERROR: Record<PriceField, (kurus: unknown) => string | null> = {
  price_kurus: priceKurusError,
  helium_price_kurus: heliumKurusError,
  cost_kurus: costKurusError,
};

function readChanges(input: unknown): { changes: PriceChange[]; description: string } {
  const body = (input ?? {}) as { changes?: unknown; description?: unknown };
  if (!Array.isArray(body.changes) || body.changes.length === 0) throw new HttpError(400, "Değişecek fiyat yok.");
  if (body.changes.length > MAX_PRICE_CHANGES) throw new HttpError(400, `Bir seferde en fazla ${MAX_PRICE_CHANGES} fiyat değiştirilebilir.`);
  const description = typeof body.description === "string" ? body.description.replace(/[\x00-\x1f\x7f]/g, " ").trim() : "";
  if (!description || description.length > MAX_DESCRIPTION_LENGTH) throw new HttpError(400, "Değişikliğin açıklaması geçersiz.");
  const seen = new Set<string>();
  const changes = (body.changes as Record<string, unknown>[]).map((c) => {
    const field = c?.field as PriceField;
    const ok =
      Number.isSafeInteger(c?.product_id) && (c.product_id as number) > 0 &&
      PRICE_FIELDS.includes(field) &&
      Number.isSafeInteger(c.old_kurus) && (c.old_kurus as number) >= 0;
    if (!ok) throw new HttpError(400, "Fiyat değişikliği verisi hatalı.");
    const error = FIELD_ERROR[field](c.new_kurus);
    if (error || c.new_kurus === null) throw new HttpError(400, error ?? "Fiyat geçersiz.");
    const key = `${c.product_id}:${field}`;
    if (seen.has(key)) throw new HttpError(400, "Aynı fiyat iki kez gönderildi.");
    seen.add(key);
    return { product_id: c.product_id as number, field, old_kurus: c.old_kurus as number, new_kurus: c.new_kurus as number };
  });
  return { changes, description };
}

function getBatch(db: Database, id: number): PriceBatch {
  const batch = db
    .query(
      `SELECT b.*, (SELECT COUNT(DISTINCT product_id) FROM price_changes WHERE batch_id = b.id) AS product_count
       FROM price_batches b WHERE b.id = ?`,
    )
    .get(id) as PriceBatch | null;
  if (!batch) throw new HttpError(404, "Toplu fiyat değişikliği bulunamadı.");
  return batch;
}

/** The newest bulk change that is not undone, or null. */
export function lastPriceBatch(db: Database): PriceBatch | null {
  const row = db.query("SELECT id FROM price_batches WHERE undone_at IS NULL ORDER BY id DESC LIMIT 1").get() as { id: number } | null;
  return row ? getBatch(db, row.id) : null;
}

/**
 * Saves the new prices in one transaction. Each change carries the old price that the user saw;
 * when a price is different now, nothing is saved.
 */
export function applyPriceChanges(db: Database, input: unknown): PriceBatchResult {
  const { changes, description } = readChanges(input);
  const t = new Date().toISOString();
  const id = db.transaction(() => {
    const { id } = db.query("INSERT INTO price_batches (description, created_at) VALUES (?, ?) RETURNING id").get(description, t) as { id: number };
    const insert = db.query("INSERT INTO price_changes (batch_id, product_id, field, old_kurus, new_kurus) VALUES (?, ?, ?, ?, ?)");
    for (const c of changes) {
      // c.field is one of PRICE_FIELDS (checked in readChanges), so it is safe in the SQL text.
      const row = db.query(`SELECT name, ${c.field} AS value FROM products WHERE id = ?`).get(c.product_id) as { name: string; value: number | null } | null;
      if (!row) throw new HttpError(409, "Listedeki bir ürün bu arada silindi. Sayfayı yenileyip tekrar deneyin.");
      if (row.value !== c.old_kurus) {
        throw new HttpError(409, `"${row.name}" ürününün fiyatı bu arada değişti. Sayfayı yenileyip tekrar deneyin.`);
      }
      db.query(`UPDATE products SET ${c.field} = ?, updated_at = ? WHERE id = ?`).run(c.new_kurus, t, c.product_id);
      insert.run(id, c.product_id, c.field, c.old_kurus, c.new_kurus);
    }
    return id;
  })();
  return { batch: getBatch(db, id), product_ids: [...new Set(changes.map((c) => c.product_id))] };
}

/**
 * Sets the prices of a bulk change back to the old values. A price that was changed again
 * after the bulk change (or whose product is gone) stays as it is.
 */
export function undoPriceBatch(db: Database, id: number): PriceUndoResult {
  const batch = getBatch(db, id);
  if (batch.undone_at) throw new HttpError(409, "Bu değişiklik zaten geri alındı.");
  const changes = db.query("SELECT * FROM price_changes WHERE batch_id = ? ORDER BY id").all(id) as PriceChange[];
  const t = new Date().toISOString();
  return db.transaction(() => {
    let restored = 0;
    const products = new Set<number>();
    for (const c of changes) {
      if (!PRICE_FIELDS.includes(c.field)) continue;
      const row = db.query(`SELECT ${c.field} AS value FROM products WHERE id = ?`).get(c.product_id) as { value: number | null } | null;
      if (!row || row.value !== c.new_kurus) continue;
      db.query(`UPDATE products SET ${c.field} = ?, updated_at = ? WHERE id = ?`).run(c.old_kurus, t, c.product_id);
      restored++;
      products.add(c.product_id);
    }
    db.query("UPDATE price_batches SET undone_at = ? WHERE id = ?").run(t, id);
    return { restored, skipped: changes.length - restored, product_ids: [...products] };
  })();
}
