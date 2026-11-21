import { describe, expect, test } from "bun:test";
import * as repo from "../src/server/db";
import { lowStock, salesReport } from "../src/server/reports";
import { addDays, bucketKey, bucketsFor, istanbulMidnightUtc, percentChange, periodFor, shiftPeriod } from "../src/shared/report";

describe("periods (Istanbul time)", () => {
  test("day, week (Monday start), month, year", () => {
    expect(periodFor("day", "2026-11-21")).toMatchObject({ start: "2026-11-21", end: "2026-11-22", label: "21 Kasım 2026" });
    // 2026-11-21 is a Saturday; its week is Monday 16th to Sunday 22nd.
    expect(periodFor("week", "2026-11-21")).toMatchObject({ start: "2026-11-16", end: "2026-11-23" });
    expect(periodFor("week", "2026-11-23").start).toBe("2026-11-23");
    expect(periodFor("month", "2026-02-14")).toMatchObject({ start: "2026-02-01", end: "2026-03-01", label: "Şubat 2026" });
    expect(periodFor("year", "2026-07-01")).toMatchObject({ start: "2026-01-01", end: "2027-01-01", label: "2026" });
    expect(() => periodFor("day", "2026-13-40")).toThrow("Geçersiz tarih");
  });

  test("previous and next period", () => {
    expect(shiftPeriod(periodFor("month", "2026-01-15"), -1).label).toBe("Aralık 2025");
    expect(shiftPeriod(periodFor("week", "2026-11-21"), 1).start).toBe("2026-11-23");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
  });

  test("buckets and bucket keys", () => {
    expect(bucketsFor(periodFor("day", "2026-11-21"))).toHaveLength(24);
    expect(bucketsFor(periodFor("week", "2026-11-21")).map((b) => b.label)[0]).toBe("Pzt 16 Kas");
    expect(bucketsFor(periodFor("month", "2026-02-01"))).toHaveLength(28);
    expect(bucketsFor(periodFor("year", "2026-02-01"))[11]).toEqual({ key: "2026-12", label: "Aralık" });
    // 22:30 UTC on 31 Dec is 01:30 on 1 Jan in Istanbul.
    expect(bucketKey("day", "2025-12-31T22:30:00.000Z")).toBe("01");
    expect(bucketKey("month", "2025-12-31T22:30:00.000Z")).toBe("2026-01-01");
    expect(bucketKey("year", "2025-12-31T22:30:00.000Z")).toBe("2026-01");
    expect(istanbulMidnightUtc("2026-01-01")).toBe("2025-12-31T21:00:00.000Z");
  });

  test("percent change", () => {
    expect(percentChange(150, 100)).toBe(50);
    expect(percentChange(50, 100)).toBe(-50);
    expect(percentChange(10, 0)).toBeNull();
  });
});

describe("sales report", () => {
  function setup() {
    const db = repo.openDatabase(":memory:");
    const tea = repo.createProduct(db, { barcode: "1", name: "Çay", price_kurus: 1000, cost_kurus: 600 }, 50);
    const pen = repo.createProduct(db, { barcode: "2", name: "Kalem", price_kurus: 500 }, 50); // no purchase price
    const order = (lines: [number, number, number][], at: string) => {
      const o = repo.createOrder(db, { lines: lines.map(([product_id, quantity, unit_price_kurus]) => ({ product_id, quantity, unit_price_kurus })) });
      db.query("UPDATE orders SET created_at = ? WHERE id = ?").run(at, o.id);
      return o;
    };
    return { db, tea, pen, order };
  }

  test("totals, profit with known costs only, cancelled orders left out", () => {
    const { db, tea, pen, order } = setup();
    order([[tea.id, 2, 1000], [pen.id, 1, 500]], "2026-11-10T09:00:00.000Z"); // 12:00 Istanbul
    order([[tea.id, 1, 1000]], "2026-11-10T20:30:00.000Z"); // 23:30 Istanbul, same day
    const cancelled = order([[tea.id, 5, 1000]], "2026-11-10T10:00:00.000Z");
    repo.cancelOrder(db, cancelled.id);
    order([[tea.id, 4, 1000]], "2026-10-05T10:00:00.000Z"); // previous month

    const r = salesReport(db, "month", "2026-11-21");
    expect(r.period.label).toBe("Kasım 2026");
    expect(r.totals).toEqual({
      revenue_kurus: 3500,
      cost_kurus: 1800,
      profit_kurus: 1200,
      unknown_cost_revenue_kurus: 500,
      orders: 2,
      pieces: 4,
      cancelled_orders: 1,
      cancelled_kurus: 5000,
    });
    expect(r.previous_totals.revenue_kurus).toBe(4000);
    expect(r.products.map((p) => [p.name, p.pieces, p.profit_kurus, p.unknown_cost])).toEqual([
      ["Çay", 3, 1200, false],
      ["Kalem", 1, 0, true],
    ]);
    const day10 = r.buckets.find((b) => b.key === "2026-11-10")!;
    expect([day10.revenue_kurus, day10.orders, day10.pieces]).toEqual([3500, 2, 4]);

    const day = salesReport(db, "day", "2026-11-10");
    expect(day.buckets.find((b) => b.key === "23")!.revenue_kurus).toBe(1000);
    expect(day.buckets.find((b) => b.key === "12")!.revenue_kurus).toBe(2500);
  });

  test("the purchase price is copied at sale time", () => {
    const { db, tea, order } = setup();
    order([[tea.id, 1, 1000]], "2026-11-10T09:00:00.000Z");
    repo.updateProduct(db, tea.id, { barcode: "1", name: "Çay", price_kurus: 1000, cost_kurus: 900 });
    expect(salesReport(db, "month", "2026-11-01").totals.profit_kurus).toBe(400);
  });

  test("unsold products and stock value", () => {
    const { db, tea, pen, order } = setup();
    order([[tea.id, 1, 1000]], "2026-11-10T09:00:00.000Z");
    const r = salesReport(db, "month", "2026-11-01");
    expect(r.unsold.map((u) => u.product_id)).toEqual([pen.id]);
    // tea: 49 in stock at 600 cost / 1000 price; pen: 50 at no cost / 500 price
    expect(r.stock).toEqual({ pieces: 99, cost_value_kurus: 49 * 600, sale_value_kurus: 49 * 1000 + 50 * 500, products_without_cost: 1 });
  });

  test("bad input", () => {
    const { db } = setup();
    expect(() => salesReport(db, "decade", "2026-01-01")).toThrow("geçersiz");
    expect(() => salesReport(db, "month", "abc")).toThrow("Geçersiz tarih");
  });
});

describe("low stock", () => {
  test("at or below the threshold, lowest first, with 30-day sales", () => {
    const db = repo.openDatabase(":memory:");
    const a = repo.createProduct(db, { barcode: "1", name: "A", price_kurus: 100 }, 5);
    repo.createProduct(db, { barcode: "2", name: "B", price_kurus: 100 }, 6);
    const c = repo.createProduct(db, { barcode: "3", name: "C", price_kurus: 100 }, 0);
    repo.createOrder(db, { lines: [{ product_id: a.id, quantity: 2, unit_price_kurus: 100 }] });
    const list = lowStock(db, 5);
    expect(list.map((p) => [p.name, p.stock_qty, p.sold_30d])).toEqual([["C", 0, 0], ["A", 3, 2]]);
    expect(list[0]!.id).toBe(c.id);
  });
});
