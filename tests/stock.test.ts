import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as repo from "../src/server/db";
import { adjustStock, listMovements, receiveStock } from "../src/server/stock";
import { parseQuantity, stockChange, stockQuantityError } from "../src/shared/stock";

const fresh = () => repo.openDatabase(":memory:");
const stockOf = (db: Database, id: number) => (db.query("SELECT stock_qty FROM products WHERE id = ?").get(id) as { stock_qty: number }).stock_qty;
const reasons = (db: Database, id: number) => listMovements(db, id).map((m) => [m.reason, m.change, m.stock_after]);

describe("stock rules", () => {
  test("change per mode", () => {
    expect(stockChange(5, "add", 3)).toBe(3);
    expect(stockChange(5, "remove", 2)).toBe(-2);
    expect(stockChange(5, "set", 12)).toBe(7);
    expect(stockChange(-4, "set", 0)).toBe(4);
  });

  test("quantity checks", () => {
    expect(stockQuantityError("add", 1)).toBeNull();
    expect(stockQuantityError("add", 0)).toContain("en az 1");
    expect(stockQuantityError("remove", 2.5)).toContain("tam sayı");
    expect(stockQuantityError("set", 0)).toBeNull();
    expect(stockQuantityError("set", -1)).toContain("eksi");
    expect(stockQuantityError("add", Number.NaN)).toContain("sayı");
    expect(stockQuantityError("add", 2_000_000)).toContain("en fazla");
  });

  test("parseQuantity accepts whole numbers only", () => {
    expect(parseQuantity(" 12 ")).toBe(12);
    expect(parseQuantity("1,5")).toBeNaN();
    expect(parseQuantity("-3")).toBeNaN();
    expect(parseQuantity("")).toBeNaN();
  });
});

describe("stock in the database", () => {
  test("new product with a starting stock", () => {
    const db = fresh();
    const p = repo.createProduct(db, { barcode: "1", name: "A", price_kurus: 100 }, 10);
    expect(p.stock_qty).toBe(10);
    expect(reasons(db, p.id)).toEqual([["initial", 10, 10]]);
    expect(repo.createProduct(db, { barcode: "2", name: "B", price_kurus: 100 }).stock_qty).toBe(0);
    expect(() => repo.validateInitialStock(-1)).toThrow("Başlangıç stoğu");
    expect(() => repo.validateInitialStock(1.5)).toThrow("Başlangıç stoğu");
  });

  test("a sale lowers the stock, a cancel gives it back, a delete changes nothing", () => {
    const db = fresh();
    const p = repo.createProduct(db, { barcode: "1", name: "A", price_kurus: 100 }, 5);
    const o = repo.createOrder(db, { lines: [{ product_id: p.id, quantity: 3, unit_price_kurus: 100 }] });
    expect(stockOf(db, p.id)).toBe(2);
    // Selling more than the stock is allowed: the stock goes below zero.
    repo.createOrder(db, { lines: [{ product_id: p.id, quantity: 4, unit_price_kurus: 100 }] });
    expect(stockOf(db, p.id)).toBe(-2);
    repo.cancelOrder(db, o.id);
    expect(stockOf(db, p.id)).toBe(1);
    repo.deleteOrder(db, o.id);
    expect(stockOf(db, p.id)).toBe(1);
    const history = listMovements(db, p.id);
    expect(history.map((m) => [m.reason, m.change, m.stock_after, m.order_no])).toEqual([
      ["sale_cancel", 3, 1, 1],
      ["sale", -4, -2, 2],
      ["sale", -3, 2, 1],
      ["initial", 5, 5, null],
    ]);
  });

  test("a failed order changes no stock", () => {
    const db = fresh();
    const p = repo.createProduct(db, { barcode: "1", name: "A", price_kurus: 100 }, 5);
    expect(() => repo.createOrder(db, { lines: [{ product_id: p.id, quantity: 1, unit_price_kurus: 999 }] })).toThrow();
    expect(stockOf(db, p.id)).toBe(5);
  });

  test("adjust: add, remove and set, with a note", () => {
    const db = fresh();
    const p = repo.createProduct(db, { barcode: "1", name: "A", price_kurus: 100 });
    expect(adjustStock(db, p.id, { mode: "add", quantity: 10, note: " Fatura 123 " }).stock_qty).toBe(10);
    expect(adjustStock(db, p.id, { mode: "remove", quantity: 2 }).stock_qty).toBe(8);
    expect(adjustStock(db, p.id, { mode: "set", quantity: 7 }).stock_qty).toBe(7);
    expect(reasons(db, p.id)).toEqual([
      ["count", -1, 7],
      ["remove", -2, 8],
      ["receive", 10, 10],
    ]);
    expect(listMovements(db, p.id).at(-1)!.note).toBe("Fatura 123");
  });

  test("adjust refuses bad input", () => {
    const db = fresh();
    const p = repo.createProduct(db, { barcode: "1", name: "A", price_kurus: 100 });
    expect(() => adjustStock(db, p.id, { mode: "steal", quantity: 1 })).toThrow("geçersiz");
    expect(() => adjustStock(db, p.id, { mode: "add", quantity: 0 })).toThrow("en az 1");
    expect(() => adjustStock(db, p.id, { mode: "add", quantity: 1, note: "x".repeat(201) })).toThrow("Not");
    expect(() => adjustStock(db, 999, { mode: "add", quantity: 1 })).toThrow("bulunamadı");
    expect(stockOf(db, p.id)).toBe(0);
  });

  test("goods in: all lines or none", () => {
    const db = fresh();
    const a = repo.createProduct(db, { barcode: "1", name: "A", price_kurus: 100 });
    const b = repo.createProduct(db, { barcode: "2", name: "B", price_kurus: 100 }, 1);
    expect(receiveStock(db, { lines: [{ product_id: a.id, quantity: 4 }, { product_id: b.id, quantity: 2 }], note: "Toptancı" })).toEqual({
      products: 2,
      pieces: 6,
    });
    expect([stockOf(db, a.id), stockOf(db, b.id)]).toEqual([4, 3]);
    expect(() => receiveStock(db, { lines: [{ product_id: a.id, quantity: 1 }, { product_id: 999, quantity: 1 }] })).toThrow("kayıtlı değil");
    expect(stockOf(db, a.id)).toBe(4); // the first line was rolled back
    expect(() => receiveStock(db, { lines: [] })).toThrow("boş");
    expect(() => receiveStock(db, { lines: [{ product_id: a.id, quantity: -1 }] })).toThrow("en az 1");
  });

  test("CSV stock column sets the stock", () => {
    const db = fresh();
    const p = repo.createProduct(db, { barcode: "1", name: "A", price_kurus: 100 }, 2);
    const r = repo.importProductsCsv(db, "barkod;ad;fiyat;stok\n1;A;1,00;9\n2;B;2,00;5\n3;C;3,00\n");
    expect([r.added, r.updated, r.failed.length]).toEqual([2, 1, 0]);
    expect(stockOf(db, p.id)).toBe(9);
    expect(repo.getProductByBarcode(db, "2")!.stock_qty).toBe(5);
    expect(repo.getProductByBarcode(db, "3")!.stock_qty).toBe(0);
    expect(reasons(db, p.id)[0]).toEqual(["import", 7, 9]);
  });

  test("deleting a product removes its stock history", () => {
    const db = fresh();
    const p = repo.createProduct(db, { barcode: "1", name: "A", price_kurus: 100 }, 3);
    repo.deleteProduct(db, p.id);
    expect((db.query("SELECT COUNT(*) AS n FROM stock_movements").get() as { n: number }).n).toBe(0);
  });

  test("old databases get the stock column with 0", () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "tezgah-stock-")), "old.db");
    const old = new Database(file);
    old.exec(
      "CREATE TABLE products (id INTEGER PRIMARY KEY, barcode TEXT NOT NULL UNIQUE, name TEXT NOT NULL, price_kurus INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
    );
    old.exec("INSERT INTO products VALUES (1, '1', 'A', 100, 'x', 'x')");
    old.close();
    const db = repo.openDatabase(file);
    expect(repo.listProducts(db)[0]!.stock_qty).toBe(0);
    expect(adjustStock(db, 1, { mode: "add", quantity: 2 }).stock_qty).toBe(2);
  });
});
