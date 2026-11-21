// Sales reports and the low-stock list. Cancelled orders are left out of every sales number.

import type { Database } from "bun:sqlite";
import { bucketKey, bucketsFor, istanbulMidnightUtc, periodFor, shiftPeriod, type Period, type PeriodKind } from "../shared/report";
import type { LowStockItem, ReportTotals, SalesReport, TopProduct } from "../shared/types";
import { HttpError } from "./db";

const KINDS: PeriodKind[] = ["day", "week", "month", "year"];

interface SaleLine {
  order_id: number;
  created_at: string;
  product_id: number;
  name: string;
  barcode: string;
  quantity: number;
  line_total_kurus: number;
  unit_cost_kurus: number | null;
}

function salesBetween(db: Database, p: Period): SaleLine[] {
  return db
    .query(
      `SELECT o.id AS order_id, o.created_at, l.product_id, COALESCE(pr.name, l.name) AS name,
              COALESCE(pr.barcode, l.barcode) AS barcode, l.quantity, l.line_total_kurus, l.unit_cost_kurus
       FROM order_lines l
       JOIN orders o ON o.id = l.order_id
       LEFT JOIN products pr ON pr.id = l.product_id
       WHERE o.cancelled_at IS NULL AND o.created_at >= ? AND o.created_at < ?`,
    )
    .all(istanbulMidnightUtc(p.start), istanbulMidnightUtc(p.end)) as SaleLine[];
}

/** Profit of one line, or null when the purchase price was not known at sale time. */
const lineProfit = (l: SaleLine) => (l.unit_cost_kurus === null ? null : l.line_total_kurus - l.unit_cost_kurus * l.quantity);

export function totalsOf(lines: SaleLine[]): Omit<ReportTotals, "cancelled_orders" | "cancelled_kurus"> {
  const totals = { revenue_kurus: 0, cost_kurus: 0, profit_kurus: 0, unknown_cost_revenue_kurus: 0, orders: 0, pieces: 0 };
  const orders = new Set<number>();
  for (const l of lines) {
    orders.add(l.order_id);
    totals.revenue_kurus += l.line_total_kurus;
    totals.pieces += l.quantity;
    const profit = lineProfit(l);
    if (profit === null) totals.unknown_cost_revenue_kurus += l.line_total_kurus;
    else {
      totals.cost_kurus += l.unit_cost_kurus! * l.quantity;
      totals.profit_kurus += profit;
    }
  }
  totals.orders = orders.size;
  return totals;
}

function cancelledBetween(db: Database, p: Period) {
  return db
    .query(
      `SELECT COUNT(*) AS n, COALESCE(SUM(total_kurus), 0) AS kurus FROM orders
       WHERE cancelled_at IS NOT NULL AND created_at >= ? AND created_at < ?`,
    )
    .get(istanbulMidnightUtc(p.start), istanbulMidnightUtc(p.end)) as { n: number; kurus: number };
}

function fullTotals(db: Database, p: Period, lines: SaleLine[]): ReportTotals {
  const cancelled = cancelledBetween(db, p);
  return { ...totalsOf(lines), cancelled_orders: cancelled.n, cancelled_kurus: cancelled.kurus };
}

export function salesReport(db: Database, kind: string, date: string): SalesReport {
  if (!KINDS.includes(kind as PeriodKind)) throw new HttpError(400, "Rapor dönemi geçersiz.");
  let period: Period;
  try {
    period = periodFor(kind as PeriodKind, date);
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
  const previous = shiftPeriod(period, -1);
  const lines = salesBetween(db, period);

  // Breakdown rows.
  const buckets = bucketsFor(period).map((b) => ({ ...b, revenue_kurus: 0, profit_kurus: 0, orders: 0, pieces: 0 }));
  const byKey = new Map(buckets.map((b) => [b.key, b]));
  const ordersPerBucket = new Map<string, Set<number>>();
  for (const l of lines) {
    const key = bucketKey(period.kind, l.created_at);
    const b = byKey.get(key);
    if (!b) continue;
    b.revenue_kurus += l.line_total_kurus;
    b.profit_kurus += lineProfit(l) ?? 0;
    b.pieces += l.quantity;
    if (!ordersPerBucket.has(key)) ordersPerBucket.set(key, new Set());
    ordersPerBucket.get(key)!.add(l.order_id);
  }
  for (const b of buckets) b.orders = ordersPerBucket.get(b.key)?.size ?? 0;

  // Products sold in the period.
  const top = new Map<number, TopProduct>();
  for (const l of lines) {
    let t = top.get(l.product_id);
    if (!t) {
      t = { product_id: l.product_id, name: l.name, barcode: l.barcode, pieces: 0, revenue_kurus: 0, profit_kurus: 0, unknown_cost: false };
      top.set(l.product_id, t);
    }
    t.pieces += l.quantity;
    t.revenue_kurus += l.line_total_kurus;
    const profit = lineProfit(l);
    if (profit === null) t.unknown_cost = true;
    else t.profit_kurus += profit;
  }

  // Products in stock that sold nothing in the period.
  const unsold = db
    .query(
      `SELECT p.id AS product_id, p.name, p.barcode, p.stock_qty, p.cost_kurus, p.price_kurus FROM products p
       WHERE p.stock_qty > 0 AND NOT EXISTS (
         SELECT 1 FROM order_lines l JOIN orders o ON o.id = l.order_id
         WHERE l.product_id = p.id AND o.cancelled_at IS NULL AND o.created_at >= ? AND o.created_at < ?)
       ORDER BY p.stock_qty * COALESCE(p.cost_kurus, p.price_kurus) DESC LIMIT 50`,
    )
    .all(istanbulMidnightUtc(period.start), istanbulMidnightUtc(period.end)) as SalesReport["unsold"];

  const stock = db
    .query(
      `SELECT COALESCE(SUM(stock_qty), 0) AS pieces,
              COALESCE(SUM(stock_qty * cost_kurus), 0) AS cost_value_kurus,
              COALESCE(SUM(stock_qty * price_kurus), 0) AS sale_value_kurus,
              COALESCE(SUM(cost_kurus IS NULL), 0) AS products_without_cost
       FROM products WHERE stock_qty > 0`,
    )
    .get() as SalesReport["stock"];

  return {
    period,
    previous,
    totals: fullTotals(db, period, lines),
    previous_totals: fullTotals(db, previous, salesBetween(db, previous)),
    buckets,
    products: [...top.values()].sort((a, b) => b.pieces - a.pieces || b.revenue_kurus - a.revenue_kurus),
    unsold,
    stock,
  };
}

/** Products at or below the threshold, lowest stock first, with the pieces sold in the last 30 days. */
export function lowStock(db: Database, threshold: number): LowStockItem[] {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  return db
    .query(
      `SELECT p.*, COALESCE((
         SELECT SUM(l.quantity) FROM order_lines l JOIN orders o ON o.id = l.order_id
         WHERE l.product_id = p.id AND o.cancelled_at IS NULL AND o.created_at >= ?), 0) AS sold_30d
       FROM products p WHERE p.stock_qty <= ? ORDER BY p.stock_qty, p.name`,
    )
    .all(since, threshold) as LowStockItem[];
}
