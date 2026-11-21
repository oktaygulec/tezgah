import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { backupDatabase, pruneBackups } from "../src/server/backup";
import * as repo from "../src/server/db";
import { DEFAULT_SETTINGS } from "../src/shared/types";

const fresh = () => repo.openDatabase(":memory:");

describe("products", () => {
  test("barcode is unique", () => {
    const db = fresh();
    repo.createProduct(db, { barcode: "111", name: "A", price_kurus: 100 });
    expect(() => repo.createProduct(db, { barcode: "111", name: "B", price_kurus: 100 })).toThrow("zaten kayıtlı");
  });

  test("input validation", () => {
    expect(() => repo.validateProductInput({ barcode: "", name: "A", price_kurus: 1 })).toThrow("Barkod");
    expect(() => repo.validateProductInput({ barcode: "1", name: " ", price_kurus: 1 })).toThrow("adı");
    expect(() => repo.validateProductInput({ barcode: "1", name: "A", price_kurus: 1.5 })).toThrow("Fiyat");
    expect(repo.validateProductInput({ barcode: " 0123 ", name: " Çay ", price_kurus: 5 })).toEqual({
      barcode: "0123",
      name: "Çay",
      price_kurus: 5,
      cost_kurus: null,
    });
    expect(repo.validateProductInput({ barcode: "1", name: "A", price_kurus: 500, cost_kurus: 320 }).cost_kurus).toBe(320);
    expect(() => repo.validateProductInput({ barcode: "1", name: "A", price_kurus: 500, cost_kurus: -1 })).toThrow("Alış fiyatı");
  });

  test("next in-store barcode skips used ones", () => {
    const db = fresh();
    expect(repo.nextBarcode(db)).toBe("2000000000015");
    repo.createProduct(db, { barcode: "2000000000015", name: "A", price_kurus: 1 });
    expect(repo.nextBarcode(db)).toBe("2000000000022");
  });
});

describe("orders", () => {
  test("order copies name and price; later price changes do not alter it", () => {
    const db = fresh();
    const tea = repo.createProduct(db, { barcode: "111", name: "Çay", price_kurus: 1250 });
    const order = repo.createOrder(db, { lines: [{ product_id: tea.id, quantity: 3, unit_price_kurus: 1250 }] });
    expect(order.order_no).toBe(1);
    expect(order.total_kurus).toBe(3750);
    repo.updateProduct(db, tea.id, { barcode: "111", name: "Çay (yeni)", price_kurus: 2000 });
    const again = repo.getOrder(db, order.id);
    expect(again.lines[0]).toMatchObject({ name: "Çay", unit_price_kurus: 1250, quantity: 3, line_total_kurus: 3750 });
    const second = repo.createOrder(db, { lines: [{ product_id: tea.id, quantity: 1, unit_price_kurus: 2000 }] });
    expect(second.order_no).toBe(2);
  });

  test("refuses an order when the price changed after scanning", () => {
    const db = fresh();
    const p = repo.createProduct(db, { barcode: "111", name: "Çay", price_kurus: 1250 });
    expect(() => repo.createOrder(db, { lines: [{ product_id: p.id, quantity: 1, unit_price_kurus: 1000 }] })).toThrow(
      "Fiyatı değişen",
    );
    expect(repo.listOrders(db)).toEqual([]);
  });

  test("refuses an empty order", () => {
    expect(() => repo.createOrder(fresh(), { lines: [] })).toThrow("boş");
  });

  test("a product on an order cannot be deleted", () => {
    const db = fresh();
    const a = repo.createProduct(db, { barcode: "1", name: "A", price_kurus: 1 });
    const b = repo.createProduct(db, { barcode: "2", name: "B", price_kurus: 1 });
    repo.createOrder(db, { lines: [{ product_id: a.id, quantity: 1, unit_price_kurus: 1 }] });
    expect(() => repo.deleteProduct(db, a.id)).toThrow("silinemez");
    repo.deleteProduct(db, b.id);
    expect(repo.listProducts(db).map((p) => p.name)).toEqual(["A"]);
  });

  test("day filter uses Istanbul days", () => {
    const db = fresh();
    const p = repo.createProduct(db, { barcode: "1", name: "A", price_kurus: 1 });
    const o = repo.createOrder(db, { lines: [{ product_id: p.id, quantity: 1, unit_price_kurus: 1 }] });
    // 2026-01-01 22:30 UTC = 2026-01-02 01:30 in Istanbul
    db.query("UPDATE orders SET created_at = ? WHERE id = ?").run("2026-01-01T22:30:00.000Z", o.id);
    expect(repo.listOrders(db, "2026-01-01")).toEqual([]);
    expect(repo.listOrders(db, "2026-01-02").map((x) => x.id)).toEqual([o.id]);
    expect(() => repo.listOrders(db, "bad")).toThrow();
  });
});

describe("CSV import", () => {
  test("adds new products, updates known barcodes, reports bad rows", () => {
    const db = fresh();
    repo.createProduct(db, { barcode: "111", name: "Eski", price_kurus: 100 });
    const result = repo.importProductsCsv(db, "barkod;ad;fiyat\n111;Yeni ad;2,00\n222;Kalem;3.50\n333;Bozuk;x\n");
    expect(result.added).toBe(1);
    expect(result.updated).toBe(1);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]!.line).toBe(4);
    expect(repo.getProductByBarcode(db, "111")).toMatchObject({ name: "Yeni ad", price_kurus: 200 });
  });
});

describe("settings", () => {
  test("defaults, save and validation", () => {
    const db = fresh();
    expect(repo.getSettings(db)).toEqual(DEFAULT_SETTINGS);
    expect(repo.saveSettings(db, { label_width_mm: 50, unknown_key: 1 }).label_width_mm).toBe(50);
    expect(repo.getSettings(db).label_width_mm).toBe(50);
    expect(() => repo.saveSettings(db, { label_width_mm: 2 })).toThrow("genişliği");
    expect(() => repo.saveSettings(db, { print_density: 7.5 })).toThrow("tam sayı");
    expect(() => repo.saveSettings(db, { print_offset_x_mm: -11 })).toThrow("Sağa kaydır");
    expect(repo.saveSettings(db, { printer_name: "Xprinter XP-470B", print_rotate_180: true }).printer_name).toBe("Xprinter XP-470B");
  });
});

describe("backups", () => {
  test("writes a backup file and keeps the newest 30", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "tezgah-test-"));
    const backups = path.join(dir, "backups");
    const db = repo.openDatabase(path.join(dir, "tezgah.db"));
    const file = backupDatabase(db, dir);
    expect(readdirSync(backups)).toContain(path.basename(file));
    for (let i = 0; i < 35; i++) writeFileSync(path.join(backups, `tezgah-20200101-0000${String(i).padStart(2, "0")}.db`), "");
    writeFileSync(path.join(backups, "other.txt"), "");
    pruneBackups(backups);
    const left = readdirSync(backups).filter((n) => n.endsWith(".db"));
    expect(left).toHaveLength(30);
    expect(left).toContain(path.basename(file)); // the newest stays
    expect(readdirSync(backups)).toContain("other.txt"); // unrelated files stay
  });
});

describe("order cancel", () => {
  test("cancel marks the order and keeps its lines; a second cancel is refused", () => {
    const db = fresh();
    const p = repo.createProduct(db, { barcode: "1", name: "A", price_kurus: 500 });
    const o = repo.createOrder(db, { lines: [{ product_id: p.id, quantity: 2, unit_price_kurus: 500 }] });
    expect(o.cancelled_at).toBeNull();
    const cancelled = repo.cancelOrder(db, o.id);
    expect(cancelled.cancelled_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(cancelled.lines).toHaveLength(1);
    expect(cancelled.total_kurus).toBe(1000);
    expect(() => repo.cancelOrder(db, o.id)).toThrow("zaten iptal");
    expect(() => repo.cancelOrder(db, 999)).toThrow("bulunamadı");
    // A product on a cancelled order is still on an order: it cannot be deleted.
    expect(() => repo.deleteProduct(db, p.id)).toThrow("silinemez");
  });

  test("only a cancelled order can be deleted; delete removes its lines", () => {
    const db = fresh();
    const p = repo.createProduct(db, { barcode: "1", name: "A", price_kurus: 500 });
    const o = repo.createOrder(db, { lines: [{ product_id: p.id, quantity: 1, unit_price_kurus: 500 }] });
    expect(() => repo.deleteOrder(db, o.id)).toThrow("Önce siparişi iptal edin");
    repo.cancelOrder(db, o.id);
    repo.deleteOrder(db, o.id);
    expect(repo.listOrders(db)).toEqual([]);
    expect((db.query("SELECT COUNT(*) AS n FROM order_lines").get() as { n: number }).n).toBe(0);
    expect(() => repo.deleteOrder(db, o.id)).toThrow("bulunamadı");
    // Order numbers are never used again, even after the newest order is deleted.
    const next = repo.createOrder(db, { lines: [{ product_id: p.id, quantity: 1, unit_price_kurus: 500 }] });
    expect(next.order_no).toBe(o.order_no + 1);
  });

  test("old databases get the cancelled_at column", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "tezgah-migrate-"));
    const file = path.join(dir, "old.db");
    const old = new Database(file);
    old.exec("CREATE TABLE orders (id INTEGER PRIMARY KEY, order_no INTEGER NOT NULL UNIQUE, total_kurus INTEGER NOT NULL, created_at TEXT NOT NULL)");
    old.exec("INSERT INTO orders VALUES (1, 1, 100, '2026-01-01T00:00:00.000Z')");
    old.close();
    const db = repo.openDatabase(file);
    expect(repo.listOrders(db)[0]).toMatchObject({ order_no: 1, cancelled_at: null });
  });
});
