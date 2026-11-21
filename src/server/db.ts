import { Database } from "bun:sqlite";
import { nextInStoreEan13 } from "../shared/barcode";
import { parseProductCsv } from "../shared/csv";
import { lineTotal, MAX_QUANTITY } from "../shared/order";
import { MAX_STOCK_QUANTITY, type StockReason } from "../shared/stock";
import { istanbulDayRange } from "../shared/time";
import { barcodeError, categoryNameError, costKurusError, heliumKurusError, nameError, priceKurusError } from "../shared/validate";
import {
  DEFAULT_SETTINGS,
  salePrice,
  validateSettings,
  type Category,
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
  stock_qty INTEGER NOT NULL DEFAULT 0,
  cost_kurus INTEGER CHECK (cost_kurus >= 0),
  category_id INTEGER REFERENCES categories(id),
  helium_price_kurus INTEGER CHECK (helium_price_kurus >= 0),
  favorite INTEGER NOT NULL DEFAULT 0,
  image_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  helium_pricing INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS product_images (
  product_id INTEGER PRIMARY KEY REFERENCES products(id),
  mime TEXT NOT NULL,
  data BLOB NOT NULL
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY,
  order_no INTEGER NOT NULL UNIQUE,
  total_kurus INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  cancelled_at TEXT
);
CREATE INDEX IF NOT EXISTS orders_created_at ON orders(created_at);
CREATE TABLE IF NOT EXISTS order_lines (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  barcode TEXT NOT NULL,
  name TEXT NOT NULL,
  unit_price_kurus INTEGER NOT NULL,
  unit_cost_kurus INTEGER,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  line_total_kurus INTEGER NOT NULL,
  helium INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS order_lines_order ON order_lines(order_id);
CREATE INDEX IF NOT EXISTS order_lines_product ON order_lines(product_id);
CREATE TABLE IF NOT EXISTS stock_movements (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id),
  change INTEGER NOT NULL,
  stock_after INTEGER NOT NULL,
  reason TEXT NOT NULL,
  order_no INTEGER,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS stock_movements_product ON stock_movements(product_id, id);
CREATE TABLE IF NOT EXISTS counters (
  name TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export function openDatabase(file: string): Database {
  const db = new Database(file, { create: true, strict: true });
  db.run("PRAGMA foreign_keys = ON");
  db.run("PRAGMA busy_timeout = 5000");
  const newCategoriesTable = !db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'categories'").get();
  db.exec(SCHEMA);
  migrate(db);
  // The first start with categories (new database, or an update from 1.4 or older) adds two categories.
  if (newCategoriesTable) {
    db.query("INSERT INTO categories (name, helium_pricing) VALUES ('Balon', 1), ('Diğer', 0)").run();
  }
  return db;
}

/** Brings a database made by an older version up to date. */
function migrate(db: Database) {
  const columns = (table: string) => (db.query(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
  const has = (table: string, column: string) => columns(table).includes(column);
  if (!has("orders", "cancelled_at")) db.run("ALTER TABLE orders ADD COLUMN cancelled_at TEXT"); // added in 1.2.0
  if (!has("products", "stock_qty")) db.run("ALTER TABLE products ADD COLUMN stock_qty INTEGER NOT NULL DEFAULT 0"); // added in 1.3.0
  if (!has("products", "cost_kurus")) db.run("ALTER TABLE products ADD COLUMN cost_kurus INTEGER CHECK (cost_kurus >= 0)"); // 1.4.0
  if (!has("order_lines", "unit_cost_kurus")) db.run("ALTER TABLE order_lines ADD COLUMN unit_cost_kurus INTEGER"); // 1.4.0
  // 1.5.0: categories with helium pricing, favorites, photos
  if (!has("products", "category_id")) db.run("ALTER TABLE products ADD COLUMN category_id INTEGER REFERENCES categories(id)");
  if (!has("products", "helium_price_kurus")) db.run("ALTER TABLE products ADD COLUMN helium_price_kurus INTEGER CHECK (helium_price_kurus >= 0)");
  if (!has("products", "favorite")) db.run("ALTER TABLE products ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0");
  if (!has("products", "image_at")) db.run("ALTER TABLE products ADD COLUMN image_at TEXT");
  if (!has("order_lines", "helium")) db.run("ALTER TABLE order_lines ADD COLUMN helium INTEGER NOT NULL DEFAULT 0");
}

const now = () => new Date().toISOString();

// ---------- stock (low level; the user-facing functions are in stock.ts) ----------

/** Changes the stock of one product and records the movement. Returns the new stock. */
export function applyStockChange(
  db: Database,
  productId: number,
  change: number,
  reason: StockReason,
  extra: { note?: string; orderNo?: number } = {},
): number {
  const row = db.query("UPDATE products SET stock_qty = stock_qty + ? WHERE id = ? RETURNING stock_qty").get(change, productId) as {
    stock_qty: number;
  } | null;
  if (!row) throw new HttpError(404, "Ürün bulunamadı.");
  db.query(
    "INSERT INTO stock_movements (product_id, change, stock_after, reason, order_no, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(productId, change, row.stock_qty, reason, extra.orderNo ?? null, extra.note ?? "", now());
  return row.stock_qty;
}

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
  const cost = body.cost_kurus ?? null;
  const category = body.category_id ?? null;
  const helium = body.helium_price_kurus ?? null;
  const error =
    barcodeError(barcode) ??
    nameError(name) ??
    priceKurusError(price) ??
    costKurusError(cost) ??
    (category !== null && !(Number.isSafeInteger(category) && (category as number) > 0) ? "Kategori geçersiz." : null) ??
    (helium !== null ? heliumKurusError(helium) : null) ??
    (body.favorite !== undefined && typeof body.favorite !== "boolean" ? "Favori değeri geçersiz." : null);
  if (error) throw new HttpError(400, error);
  return {
    barcode,
    name,
    price_kurus: price as number,
    cost_kurus: cost as number | null,
    category_id: category as number | null,
    helium_price_kurus: helium as number | null,
    // Missing = keep the saved value (on update).
    ...(body.favorite === undefined ? {} : { favorite: body.favorite as boolean }),
  };
}

/**
 * Checks the category of a product. A category with helium pricing needs the helium price;
 * other categories (and no category) never keep one.
 */
function applyCategory(db: Database, input: ProductInput): ProductInput {
  const categoryId = input.category_id ?? null;
  if (categoryId === null) return { ...input, category_id: null, helium_price_kurus: null };
  const category = db.query("SELECT * FROM categories WHERE id = ?").get(categoryId) as Category | null;
  if (!category) throw new HttpError(400, "Seçilen kategori artık yok. Listeyi yenileyip tekrar seçin.");
  if (!category.helium_pricing) return { ...input, helium_price_kurus: null };
  const error = heliumKurusError(input.helium_price_kurus);
  if (error) throw new HttpError(400, `${category.name} kategorisi için ${error.charAt(0).toLocaleLowerCase("tr-TR")}${error.slice(1)}`);
  return input;
}

function assertBarcodeFree(db: Database, barcode: string, exceptId?: number) {
  const other = getProductByBarcode(db, barcode);
  if (other && other.id !== exceptId) {
    throw new HttpError(409, `Bu barkod zaten kayıtlı: ${other.name}`);
  }
}

/** Optional starting stock for a new product: a whole number from 0 up. */
export function validateInitialStock(value: unknown): number {
  if (value === undefined || value === null) return 0;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > MAX_STOCK_QUANTITY) {
    throw new HttpError(400, "Başlangıç stoğu 0 veya daha büyük bir tam sayı olmalı.");
  }
  return value;
}

export function createProduct(db: Database, raw: ProductInput, initialStock = 0): Product {
  assertBarcodeFree(db, raw.barcode);
  const input = applyCategory(db, raw);
  const t = now();
  return db.transaction(() => {
    const product = db
      .query(
        `INSERT INTO products (barcode, name, price_kurus, cost_kurus, category_id, helium_price_kurus, favorite, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      )
      .get(input.barcode, input.name, input.price_kurus, input.cost_kurus ?? null, input.category_id ?? null, input.helium_price_kurus ?? null, input.favorite ? 1 : 0, t, t) as Product;
    if (initialStock !== 0) product.stock_qty = applyStockChange(db, product.id, initialStock, "initial");
    return product;
  })();
}

export function updateProduct(db: Database, id: number, raw: ProductInput): Product {
  const old = getProduct(db, id);
  assertBarcodeFree(db, raw.barcode, id);
  const input = applyCategory(db, raw);
  return db
    .query(
      `UPDATE products SET barcode = ?, name = ?, price_kurus = ?, cost_kurus = ?, category_id = ?, helium_price_kurus = ?,
              favorite = ?, updated_at = ? WHERE id = ? RETURNING *`,
    )
    .get(
      input.barcode,
      input.name,
      input.price_kurus,
      input.cost_kurus ?? null,
      input.category_id ?? null,
      input.helium_price_kurus ?? null,
      // A client that does not send "favorite" keeps the saved value.
      input.favorite === undefined ? old.favorite : input.favorite ? 1 : 0,
      now(),
      id,
    ) as Product;
}

/** Adds the product to the favorites of Satış ("Ürün seç") or removes it. */
export function setFavorite(db: Database, id: number, favorite: unknown): Product {
  if (typeof favorite !== "boolean") throw new HttpError(400, "Favori değeri geçersiz.");
  getProduct(db, id);
  return db.query("UPDATE products SET favorite = ? WHERE id = ? RETURNING *").get(favorite ? 1 : 0, id) as Product;
}

// ---------- product photos ----------

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

/** The image type from the first bytes of the file; null when it is not JPEG, PNG or WebP. */
export function imageMime(bytes: Uint8Array): string | null {
  const at = (i: number, ...values: number[]) => values.every((v, k) => bytes[i + k] === v);
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp";
  return null;
}

export function setProductImage(db: Database, id: number, bytes: Uint8Array): Product {
  getProduct(db, id);
  if (bytes.length === 0) throw new HttpError(400, "Fotoğraf boş.");
  if (bytes.length > MAX_IMAGE_BYTES) throw new HttpError(413, "Fotoğraf çok büyük (en fazla 2 MB).");
  const mime = imageMime(bytes);
  if (!mime) throw new HttpError(415, "Fotoğraf JPEG, PNG veya WebP olmalı.");
  return db.transaction(() => {
    db.query(
      "INSERT INTO product_images (product_id, mime, data) VALUES (?, ?, ?) ON CONFLICT(product_id) DO UPDATE SET mime = excluded.mime, data = excluded.data",
    ).run(id, mime, bytes);
    return db.query("UPDATE products SET image_at = ? WHERE id = ? RETURNING *").get(now(), id) as Product;
  })();
}

export function deleteProductImage(db: Database, id: number): Product {
  getProduct(db, id);
  return db.transaction(() => {
    db.query("DELETE FROM product_images WHERE product_id = ?").run(id);
    return db.query("UPDATE products SET image_at = NULL WHERE id = ? RETURNING *").get(id) as Product;
  })();
}

export function getProductImage(db: Database, id: number): { mime: string; data: Uint8Array } | null {
  return db.query("SELECT mime, data FROM product_images WHERE product_id = ?").get(id) as { mime: string; data: Uint8Array } | null;
}

// ---------- categories ----------

export function listCategories(db: Database): Category[] {
  return db
    .query(
      `SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS product_count
       FROM categories c ORDER BY c.name COLLATE NOCASE`,
    )
    .all() as Category[];
}

function getCategory(db: Database, id: number): Category {
  const category = listCategories(db).find((c) => c.id === id);
  if (!category) throw new HttpError(404, "Kategori bulunamadı.");
  return category;
}

function validateCategoryInput(db: Database, input: unknown, exceptId?: number): { name: string; helium: number } {
  const body = (input ?? {}) as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const error = categoryNameError(name) ?? (typeof body.helium_pricing !== "boolean" ? "Helyumlu fiyat seçeneği geçersiz." : null);
  if (error) throw new HttpError(400, error);
  const other = db.query("SELECT id FROM categories WHERE name = ? COLLATE NOCASE").get(name) as { id: number } | null;
  if (other && other.id !== exceptId) throw new HttpError(409, `Bu adla bir kategori zaten var: ${name}`);
  return { name, helium: body.helium_pricing ? 1 : 0 };
}

export function createCategory(db: Database, input: unknown): Category {
  const c = validateCategoryInput(db, input);
  const { id } = db.query("INSERT INTO categories (name, helium_pricing) VALUES (?, ?) RETURNING id").get(c.name, c.helium) as { id: number };
  return getCategory(db, id);
}

/** Renames a category or changes its pricing. Without helium pricing, its products lose their helium price. */
export function updateCategory(db: Database, id: number, input: unknown): Category {
  getCategory(db, id);
  const c = validateCategoryInput(db, input, id);
  db.transaction(() => {
    db.query("UPDATE categories SET name = ?, helium_pricing = ? WHERE id = ?").run(c.name, c.helium, id);
    if (!c.helium) db.query("UPDATE products SET helium_price_kurus = NULL WHERE category_id = ?").run(id);
  })();
  return getCategory(db, id);
}

export function deleteCategory(db: Database, id: number): void {
  const category = getCategory(db, id);
  if (category.product_count > 0) {
    throw new HttpError(409, `"${category.name}" kategorisinde ${category.product_count} ürün var. Önce ürünleri başka kategoriye taşıyın.`);
  }
  db.query("DELETE FROM categories WHERE id = ?").run(id);
}

export function deleteProduct(db: Database, id: number): void {
  getProduct(db, id);
  const used = db.query("SELECT COUNT(*) AS n FROM order_lines WHERE product_id = ?").get(id) as { n: number };
  if (used.n > 0) throw new HttpError(409, "Bu ürün bir siparişte kullanıldığı için silinemez.");
  db.transaction(() => {
    db.query("DELETE FROM stock_movements WHERE product_id = ?").run(id); // the history goes with the product
    db.query("DELETE FROM product_images WHERE product_id = ?").run(id);
    db.query("DELETE FROM products WHERE id = ?").run(id);
  })();
}

export function nextBarcode(db: Database): string {
  const rows = db.query("SELECT barcode FROM products WHERE barcode LIKE '2%' AND length(barcode) = 13").all() as {
    barcode: string;
  }[];
  return nextInStoreEan13(rows.map((r) => r.barcode));
}

/**
 * Imports CSV text. A known barcode updates that product; a new barcode adds a product.
 * When the optional "stok" column has a value, the stock is set to it (recorded as a movement).
 */
export function importProductsCsv(db: Database, text: string): ImportResult {
  const { rows, errors } = parseProductCsv(text);
  const result: ImportResult = { added: 0, updated: 0, failed: [...errors] };
  const t = now();
  const findStmt = db.query("SELECT id, stock_qty FROM products WHERE barcode = ?");
  const insertStmt = db.query(
    "INSERT INTO products (barcode, name, price_kurus, cost_kurus, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id",
  );
  const updateStmt = db.query("UPDATE products SET name = ?, price_kurus = ?, updated_at = ? WHERE id = ?");
  const costStmt = db.query("UPDATE products SET cost_kurus = ? WHERE id = ?");

  db.transaction(() => {
    for (const row of rows) {
      const existing = findStmt.get(row.barcode) as { id: number; stock_qty: number } | null;
      let id: number;
      let current = 0;
      if (existing) {
        updateStmt.run(row.name, row.price_kurus, t, existing.id);
        // An empty "alis_fiyati" cell keeps the purchase price that is already saved.
        if (row.cost_kurus !== undefined) costStmt.run(row.cost_kurus, existing.id);
        id = existing.id;
        current = existing.stock_qty;
        result.updated++;
      } else {
        id = (insertStmt.get(row.barcode, row.name, row.price_kurus, row.cost_kurus ?? null, t, t) as { id: number }).id;
        result.added++;
      }
      if (row.stock_qty !== undefined && row.stock_qty !== current) {
        applyStockChange(db, id, row.stock_qty - current, "import");
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
      if (!Number.isSafeInteger(raw?.product_id) || !Number.isSafeInteger(raw?.quantity) || raw.quantity < 1 || raw.quantity > MAX_QUANTITY) {
        throw new HttpError(400, "Sipariş satırı geçersiz.");
      }
      const product = db.query("SELECT * FROM products WHERE id = ?").get(raw.product_id) as Product | null;
      if (!product) throw new HttpError(409, "Siparişteki bir ürün artık kayıtlı değil. Satırı silip tekrar okutun.");
      const helium = raw.helium === true;
      if (helium && product.helium_price_kurus === null) {
        throw new HttpError(409, `${product.name} ürününün helyumlu fiyatı yok. Satırdaki "Helyumlu" işaretini kaldırın.`);
      }
      const price = salePrice(product, helium);
      if (price !== raw.unit_price_kurus) changed.push(product.name);
      priced.push({
        product_id: product.id,
        barcode: product.barcode,
        name: product.name,
        unit_price_kurus: price,
        unit_cost_kurus: product.cost_kurus,
        quantity: raw.quantity,
        line_total_kurus: lineTotal({ unit_price_kurus: price, quantity: raw.quantity }),
        helium: helium ? 1 : 0,
      });
    }
    if (changed.length > 0) {
      throw new HttpError(409, `Fiyatı değişen ürünler var: ${changed.join(", ")}. Fiyatlar güncellendi, kontrol edip tekrar tamamlayın.`);
    }

    const total = priced.reduce((sum, l) => sum + l.line_total_kurus, 0);
    // The counter keeps order numbers unique even after the newest order is deleted.
    const { next } = db
      .query(
        `SELECT MAX(COALESCE((SELECT MAX(order_no) FROM orders), 0),
                    COALESCE((SELECT value FROM counters WHERE name = 'order_no'), 0)) + 1 AS next`,
      )
      .get() as { next: number };
    db.query("INSERT INTO counters (name, value) VALUES ('order_no', ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value").run(next);
    const order = db
      .query("INSERT INTO orders (order_no, total_kurus, created_at) VALUES (?, ?, ?) RETURNING id")
      .get(next, total, now()) as { id: number };
    const insertLine = db.query(
      `INSERT INTO order_lines (order_id, product_id, barcode, name, unit_price_kurus, unit_cost_kurus, quantity, line_total_kurus, helium)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const l of priced) {
      insertLine.run(order.id, l.product_id, l.barcode, l.name, l.unit_price_kurus, l.unit_cost_kurus, l.quantity, l.line_total_kurus, l.helium);
      applyStockChange(db, l.product_id, -l.quantity, "sale", { orderNo: next });
    }
    return getOrder(db, order.id);
  })();
}

/** Marks a saved order as cancelled and gives the sold pieces back to stock. The order stays for the record. */
export function cancelOrder(db: Database, id: number): OrderWithLines {
  const order = getOrder(db, id);
  if (order.cancelled_at) throw new HttpError(409, `Sipariş No ${order.order_no} zaten iptal edilmiş.`);
  db.transaction(() => {
    db.query("UPDATE orders SET cancelled_at = ? WHERE id = ?").run(now(), id);
    for (const line of order.lines) {
      applyStockChange(db, line.product_id, line.quantity, "sale_cancel", { orderNo: order.order_no });
    }
  })();
  return getOrder(db, id);
}

/**
 * Permanently deletes an order and its lines. Only a cancelled order can be deleted;
 * its stock was already given back at cancel time, so the stock does not change here.
 */
export function deleteOrder(db: Database, id: number): void {
  const order = getOrder(db, id);
  if (!order.cancelled_at) throw new HttpError(409, "Yalnızca iptal edilmiş bir sipariş silinebilir. Önce siparişi iptal edin.");
  db.transaction(() => {
    db.query("DELETE FROM order_lines WHERE order_id = ?").run(id);
    db.query("DELETE FROM orders WHERE id = ?").run(id);
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
