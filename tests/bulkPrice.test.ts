import { describe, expect, test } from "bun:test";
import { applyRule, describeRule, parseRuleValue, planPriceChanges, type PriceRule } from "../src/shared/bulkPrice";
import * as repo from "../src/server/db";
import { applyPriceChanges, lastPriceBatch, undoPriceBatch } from "../src/server/prices";

describe("parseRuleValue", () => {
  test("percent", () => {
    expect(parseRuleValue("increase_percent", "10")).toBe(1000);
    expect(parseRuleValue("increase_percent", "%7,5")).toBe(750);
    expect(parseRuleValue("decrease_percent", "12.25")).toBe(1225);
    expect(parseRuleValue("increase_percent", "")).toBe("Oranı yazın.");
    expect(typeof parseRuleValue("increase_percent", "0")).toBe("string");
    expect(typeof parseRuleValue("increase_percent", "-5")).toBe("string");
    expect(typeof parseRuleValue("increase_percent", "1,234")).toBe("string");
    expect(typeof parseRuleValue("increase_percent", "1001")).toBe("string");
    expect(typeof parseRuleValue("decrease_percent", "100")).toBe("string");
  });

  test("amount", () => {
    expect(parseRuleValue("increase_amount", "2,50")).toBe(250);
    expect(parseRuleValue("set", "15")).toBe(1500);
    expect(typeof parseRuleValue("decrease_amount", "0")).toBe("string");
    expect(typeof parseRuleValue("decrease_amount", "-2")).toBe("string");
    expect(typeof parseRuleValue("set", "abc")).toBe("string");
  });
});

describe("applyRule", () => {
  const rule = (mode: PriceRule["mode"], value: number, roundTo = 0): PriceRule => ({ mode, value, roundTo });

  test("percent with half-kuruş rounding", () => {
    expect(applyRule(1000, rule("increase_percent", 1000))).toBe(1100);
    expect(applyRule(2310, rule("increase_percent", 1000))).toBe(2541);
    expect(applyRule(1000, rule("decrease_percent", 2500))).toBe(750);
    expect(applyRule(5, rule("increase_percent", 1000))).toBe(6); // 5,5 kuruş rounds up
  });

  test("rounds up to the step", () => {
    expect(applyRule(2310, rule("increase_percent", 1000, 100))).toBe(2600);
    expect(applyRule(2310, rule("increase_percent", 1000, 50))).toBe(2550);
    expect(applyRule(2500, rule("increase_amount", 0 + 500, 500))).toBe(3000);
    expect(applyRule(2600, rule("increase_amount", 500, 500))).toBe(3500);
  });

  test("amount and set", () => {
    expect(applyRule(1000, rule("increase_amount", 250))).toBe(1250);
    expect(applyRule(1000, rule("decrease_amount", 250))).toBe(750);
    expect(applyRule(100, rule("decrease_amount", 150))).toBe("Fiyat eksiye düşüyor.");
    expect(applyRule(100, rule("decrease_amount", 150, 100))).toBe("Fiyat eksiye düşüyor.");
    expect(applyRule(1234, rule("set", 1500, 1000))).toBe(1500); // no rounding for "set"
  });

  test("describe", () => {
    expect(describeRule(rule("increase_percent", 750, 100), ["price_kurus", "helium_price_kurus"])).toBe(
      "satış fiyatı, helyumlu fiyat: %7,5 artış, ₺1,00 katına yukarı yuvarlama",
    );
    expect(describeRule(rule("set", 1500, 100), ["cost_kurus"])).toBe("alış fiyatı: yeni fiyat ₺15,00");
  });
});

describe("planPriceChanges", () => {
  test("skips missing and unchanged prices, reports errors", () => {
    const products = [
      { id: 1, name: "A", price_kurus: 1000, helium_price_kurus: null, cost_kurus: 600 },
      { id: 2, name: "B", price_kurus: 1500, helium_price_kurus: 3000, cost_kurus: null },
      { id: 3, name: "C", price_kurus: 100, helium_price_kurus: null, cost_kurus: null },
    ];
    const plan = planPriceChanges(products, ["price_kurus", "helium_price_kurus", "cost_kurus"], { mode: "decrease_amount", value: 500, roundTo: 0 });
    expect(plan.changes).toEqual([
      { product_id: 1, field: "price_kurus", old_kurus: 1000, new_kurus: 500 },
      { product_id: 1, field: "cost_kurus", old_kurus: 600, new_kurus: 100 },
      { product_id: 2, field: "price_kurus", old_kurus: 1500, new_kurus: 1000 },
      { product_id: 2, field: "helium_price_kurus", old_kurus: 3000, new_kurus: 2500 },
    ]);
    expect(plan.errors).toEqual([{ product_id: 3, name: "C", field: "price_kurus", message: "Fiyat eksiye düşüyor." }]);

    const same = planPriceChanges(products, ["price_kurus"], { mode: "set", value: 1000, roundTo: 0 });
    expect(same.changes.map((c) => c.product_id)).toEqual([2, 3]);
  });
});

describe("bulk price changes in the database", () => {
  function setup() {
    const db = repo.openDatabase(":memory:");
    const balon = repo.listCategories(db).find((c) => c.helium_pricing === 1)!;
    const a = repo.createProduct(db, { barcode: "1", name: "Kalem", price_kurus: 1000, cost_kurus: 600 });
    const b = repo.createProduct(db, { barcode: "2", name: "Balon", price_kurus: 500, category_id: balon.id, helium_price_kurus: 2000 });
    return { db, a, b };
  }
  const price = (db: ReturnType<typeof setup>["db"], barcode: string) => repo.getProductByBarcode(db, barcode)!;

  test("applies, records and undoes", () => {
    const { db, a, b } = setup();
    expect(lastPriceBatch(db)).toBeNull();
    const result = applyPriceChanges(db, {
      description: "satış fiyatı: %10 artış",
      changes: [
        { product_id: a.id, field: "price_kurus", old_kurus: 1000, new_kurus: 1100 },
        { product_id: b.id, field: "price_kurus", old_kurus: 500, new_kurus: 550 },
        { product_id: b.id, field: "helium_price_kurus", old_kurus: 2000, new_kurus: 2200 },
      ],
    });
    expect(result.product_ids).toEqual([a.id, b.id]);
    expect(result.batch.product_count).toBe(2);
    expect(price(db, "1").price_kurus).toBe(1100);
    expect(price(db, "2").helium_price_kurus).toBe(2200);
    expect(lastPriceBatch(db)?.id).toBe(result.batch.id);

    // A price changed by hand after the bulk change stays as it is.
    repo.updateProduct(db, a.id, { barcode: "1", name: "Kalem", price_kurus: 1250, cost_kurus: 600 });
    const undo = undoPriceBatch(db, result.batch.id);
    expect(undo).toEqual({ restored: 2, skipped: 1, product_ids: [b.id] });
    expect(price(db, "1").price_kurus).toBe(1250);
    expect(price(db, "2").price_kurus).toBe(500);
    expect(price(db, "2").helium_price_kurus).toBe(2000);
    expect(lastPriceBatch(db)).toBeNull();
    expect(() => undoPriceBatch(db, result.batch.id)).toThrow("zaten geri alındı");
  });

  test("refuses a stale old price and saves nothing", () => {
    const { db, a, b } = setup();
    expect(() =>
      applyPriceChanges(db, {
        description: "x",
        changes: [
          { product_id: b.id, field: "price_kurus", old_kurus: 500, new_kurus: 600 },
          { product_id: a.id, field: "price_kurus", old_kurus: 999, new_kurus: 1100 },
        ],
      }),
    ).toThrow("bu arada değişti");
    expect(price(db, "2").price_kurus).toBe(500);
    expect(lastPriceBatch(db)).toBeNull();
  });

  test("checks the input", () => {
    const { db, a } = setup();
    const one = (c: Record<string, unknown>) => () => applyPriceChanges(db, { description: "x", changes: [{ product_id: a.id, field: "price_kurus", old_kurus: 1000, new_kurus: 1100, ...c }] });
    expect(() => applyPriceChanges(db, { description: "x", changes: [] })).toThrow("Değişecek fiyat yok");
    expect(one({ field: "name" })).toThrow("hatalı");
    expect(one({ new_kurus: -1 })).toThrow("eksi");
    expect(one({ new_kurus: 1.5 })).toThrow("geçersiz");
    expect(one({ field: "cost_kurus", new_kurus: null })).toThrow("geçersiz");
    // Kalem has no helium price, so its helium price cannot change.
    expect(one({ field: "helium_price_kurus", old_kurus: 0 })).toThrow("bu arada değişti");
    expect(() =>
      applyPriceChanges(db, {
        description: "x",
        changes: [
          { product_id: a.id, field: "price_kurus", old_kurus: 1000, new_kurus: 1100 },
          { product_id: a.id, field: "price_kurus", old_kurus: 1000, new_kurus: 1200 },
        ],
      }),
    ).toThrow("iki kez");
  });

  test("deleting a product with a bulk change still works", () => {
    const { db, a } = setup();
    applyPriceChanges(db, { description: "x", changes: [{ product_id: a.id, field: "price_kurus", old_kurus: 1000, new_kurus: 1100 }] });
    repo.deleteProduct(db, a.id);
    expect(undoPriceBatch(db, lastPriceBatch(db)!.id)).toEqual({ restored: 0, skipped: 1, product_ids: [] });
  });
});
