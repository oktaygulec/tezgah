import { Database } from "bun:sqlite";
import { nextInStoreEan13 } from "../shared/barcode";
import { parseProductCsv } from "../shared/csv";
import { MAX_PRICE_KURUS } from "../shared/money";
import { lineTotal } from "../shared/order";
import { istanbulDayRange } from "../shared/time";
import {
  DEFAULT_SETTINGS,
  validateSettings,
  type ImportResult,
  type NewOrderLine,
  type Order,
  type OrderLine,
  type OrderWithLines,
  type Product,
  type ProductInput,
  type Settings,
} from "../shared/types";

/** An error with an HTTP status and a Turkish message that the user will see. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY,
  barcode TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  price_kurus INTEGER NOT NULL CHECK (price_kurus >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY,
  order_no INTEGER NOT NULL UNIQUE,
  total_kurus INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS orders_created_at ON orders(created_at);
CREATE TABLE IF NOT EXISTS order_lines (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  barcode TEXT NOT NULL,
  name TEXT NOT NULL,
  unit_price_kurus INTEGER NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  line_total_kurus INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS order_lines_order ON order_lines(order_id);
CREATE INDEX IF NOT EXISTS order_lines_product ON order_lines(product_id);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export function openDatabase(file: string): Database {
  const db = new Database(file, { create: true, strict: true });
  db.run("PRAGMA foreign_keys = ON");
  db.run("PRAGMA busy_timeout = 5000");
  db.exec(SCHEMA);
  return db;
}

const now = () => new Date().toISOString();

// ---------- products ----------

export function listProducts(db: Database): Product[] {
  return db.query("SELECT * FROM products ORDER BY name").all() as Product[];
}

export function getProductByBarcode(db: Database, barcode: string): Product | null {
  return db.query("SELECT * FROM products WHERE barcode = ?").get(barcode) as Product | null;
}

function getProduct(db: Database, id: number): Product {
  const product = db.query("SELECT * FROM products WHERE id = ?").get(id) as Product | null;
  if (!product) throw new HttpError(404, "Ürün bulunamadı.");
  return product;
}

/** Checks and cleans product input from the client. */
export function validateProductInput(input: unknown): ProductInput {
  const body = (input ?? {}) as Record<string, unknown>;
  const barcode = typeof body.barcode === "string" ? body.barcode.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const price = body.price_kurus;
  if (!barcode) throw new HttpError(400, "Barkod boş olamaz.");
  if (barcode.length > 64 || /\s/.test(barcode)) throw new HttpError(400, "Barkod en fazla 64 karakter olmalı ve boşluk içermemeli.");
  if (!name) throw new HttpError(400, "Ürün adı boş olamaz.");
  if (name.length > 200) throw new HttpError(400, "Ürün adı en fazla 200 karakter olabilir.");
  if (typeof price !== "number" || !Number.isSafeInteger(price) || price < 0 || price > MAX_PRICE_KURUS) {
    throw new HttpError(400, "Fiyat geçersiz.");
  }
  return { barcode, name, price_kurus: price };
}

function assertBarcodeFree(db: Database, barcode: string, exceptId?: number) {
  const other = getProductByBarcode(db, barcode);
  if (other && other.id !== exceptId) {
    throw new HttpError(409, `Bu barkod zaten kayıtlı: ${other.name}`);
  }
}

export function createProduct(db: Database, input: ProductInput): Product {
  assertBarcodeFree(db, input.barcode);
  const t = now();
  return db
    .query("INSERT INTO products (barcode, name, price_kurus, created_at, updated_at) VALUES (?, ?, ?, ?, ?) RETURNING *")
    .get(input.barcode, input.name, input.price_kurus, t, t) as Product;
}

export function updateProduct(db: Database, id: number, input: ProductInput): Product {
  getProduct(db, id);
  assertBarcodeFree(db, input.barcode, id);
  return db
    .query("UPDATE products SET barcode = ?, name = ?, price_kurus = ?, updated_at = ? WHERE id = ? RETURNING *")
    .get(input.barcode, input.name, input.price_kurus, now(), id) as Product;
}

export function deleteProduct(db: Database, id: number): void {
  getProduct(db, id);
  const used = db.query("SELECT COUNT(*) AS n FROM order_lines WHERE product_id = ?").get(id) as { n: number };
  if (used.n > 0) throw new HttpError(409, "Bu ürün bir siparişte kullanıldığı için silinemez.");
  db.query("DELETE FROM products WHERE id = ?").run(id);
}

export function nextBarcode(db: Database): string {
  const rows = db.query("SELECT barcode FROM products WHERE barcode LIKE '2%' AND length(barcode) = 13").all() as {
    barcode: string;
  }[];
  return nextInStoreEan13(rows.map((r) => r.barcode));
}

/** Imports CSV text. A known barcode updates that product; a new barcode adds a product. */
export function importProductsCsv(db: Database, text: string): ImportResult {
  const { rows, errors } = parseProductCsv(text);
  const result: ImportResult = { added: 0, updated: 0, failed: [...errors] };
  const t = now();
  const findStmt = db.query("SELECT id FROM products WHERE barcode = ?");
  const insertStmt = db.query(
    "INSERT INTO products (barcode, name, price_kurus, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  );
  const updateStmt = db.query("UPDATE products SET name = ?, price_kurus = ?, updated_at = ? WHERE id = ?");

  db.transaction(() => {
    for (const row of rows) {
      const existing = findStmt.get(row.barcode) as { id: number } | null;
      if (existing) {
        updateStmt.run(row.name, row.price_kurus, t, existing.id);
        result.updated++;
      } else {
        insertStmt.run(row.barcode, row.name, row.price_kurus, t, t);
        result.added++;
      }
    }
  })();
  result.failed.sort((a, b) => a.line - b.line);
  return result;
}

// ---------- orders ----------

export function createOrder(db: Database, input: unknown): OrderWithLines {
  const lines = (input as { lines?: unknown })?.lines;
  if (!Array.isArray(lines) || lines.length === 0) throw new HttpError(400, "Sipariş boş.");

  return db.transaction(() => {
    const priced: Omit<OrderLine, "id" | "order_id">[] = [];
    const changed: string[] = [];
    for (const raw of lines as NewOrderLine[]) {
      if (!Number.isSafeInteger(raw?.product_id) || !Number.isSafeInteger(raw?.quantity) || raw.quantity < 1 || raw.quantity > 100000) {
        throw new HttpError(400, "Sipariş satırı geçersiz.");
      }
      const product = db.query("SELECT * FROM products WHERE id = ?").get(raw.product_id) as Product | null;
      if (!product) throw new HttpError(409, "Siparişteki bir ürün artık kayıtlı değil. Satırı silip tekrar okutun.");
      if (product.price_kurus !== raw.unit_price_kurus) changed.push(product.name);
      priced.push({
        product_id: product.id,
        barcode: product.barcode,
        name: product.name,
        unit_price_kurus: product.price_kurus,
        quantity: raw.quantity,
        line_total_kurus: lineTotal({ unit_price_kurus: product.price_kurus, quantity: raw.quantity }),
      });
    }
    if (changed.length > 0) {
      throw new HttpError(409, `Fiyatı değişen ürünler var: ${changed.join(", ")}. Fiyatlar güncellendi, kontrol edip tekrar tamamlayın.`);
    }

    const total = priced.reduce((sum, l) => sum + l.line_total_kurus, 0);
    const { next } = db.query("SELECT COALESCE(MAX(order_no), 0) + 1 AS next FROM orders").get() as { next: number };
    const order = db
      .query("INSERT INTO orders (order_no, total_kurus, created_at) VALUES (?, ?, ?) RETURNING id")
      .get(next, total, now()) as { id: number };
    const insertLine = db.query(
      `INSERT INTO order_lines (order_id, product_id, barcode, name, unit_price_kurus, quantity, line_total_kurus)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const l of priced) {
      insertLine.run(order.id, l.product_id, l.barcode, l.name, l.unit_price_kurus, l.quantity, l.line_total_kurus);
    }
    return getOrder(db, order.id);
  })();
}

const ORDER_SELECT = `
  SELECT o.*, (SELECT COUNT(*) FROM order_lines l WHERE l.order_id = o.id) AS line_count
  FROM orders o`;

/** Orders of one Istanbul day ("YYYY-MM-DD"), or the latest 200 when no day is given. Newest first. */
export function listOrders(db: Database, day?: string): Order[] {
  if (!day) return db.query(`${ORDER_SELECT} ORDER BY o.order_no DESC LIMIT 200`).all() as Order[];
  let range: [string, string];
  try {
    range = istanbulDayRange(day);
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
  return db
    .query(`${ORDER_SELECT} WHERE o.created_at >= ? AND o.created_at < ? ORDER BY o.order_no DESC`)
    .all(range[0], range[1]) as Order[];
}

export function getOrder(db: Database, id: number): OrderWithLines {
  const order = db.query(`${ORDER_SELECT} WHERE o.id = ?`).get(id) as Order | null;
  if (!order) throw new HttpError(404, "Sipariş bulunamadı.");
  const lines = db.query("SELECT * FROM order_lines WHERE order_id = ? ORDER BY id").all(id) as OrderLine[];
  return { ...order, lines };
}

// ---------- settings ----------

export function getSettings(db: Database): Settings {
  const rows = db.query("SELECT key, value FROM settings").all() as { key: string; value: string }[];
  const settings: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    if (!(row.key in DEFAULT_SETTINGS)) continue;
    try {
      settings[row.key] = JSON.parse(row.value);
    } catch {
      console.error(`Ayar okunamadı, varsayılan kullanılıyor: ${row.key}=${row.value}`);
    }
  }
  return settings as unknown as Settings;
}

export function saveSettings(db: Database, input: unknown): Settings {
  const merged = { ...getSettings(db), ...(input as object) } as Settings;
  for (const key of Object.keys(merged)) {
    if (!(key in DEFAULT_SETTINGS)) delete (merged as unknown as Record<string, unknown>)[key];
  }
  if (typeof merged.shop_name === "string") merged.shop_name = merged.shop_name.trim();
  const error = validateSettings(merged);
  if (error) throw new HttpError(400, error);
  const upsert = db.query("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
  db.transaction(() => {
    for (const [key, value] of Object.entries(merged)) upsert.run(key, JSON.stringify(value));
  })();
  return merged;
}
