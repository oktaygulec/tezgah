// Toplu Fiyat: the price rule (percent or amount, rounding) and its arithmetic. Amounts are integer kuruş.

import { MAX_PRICE_KURUS, formatMoney, parseMoney } from "./money";

/** The product prices that a bulk change can touch. */
export type PriceField = "price_kurus" | "helium_price_kurus" | "cost_kurus";
export const PRICE_FIELDS: readonly PriceField[] = ["price_kurus", "helium_price_kurus", "cost_kurus"];

export const PRICE_FIELD_NAMES: Record<PriceField, string> = {
  price_kurus: "Satış fiyatı",
  helium_price_kurus: "Helyumlu fiyat",
  cost_kurus: "Alış fiyatı",
};

export type ChangeMode = "increase_percent" | "decrease_percent" | "increase_amount" | "decrease_amount" | "set";

export interface PriceRule {
  mode: ChangeMode;
  /** Percent modes: hundredths of a percent (750 = %7,5). Other modes: kuruş. */
  value: number;
  /** Rounds the result up to a multiple of this many kuruş; 0 = no rounding. Not used by "set". */
  roundTo: number;
}

export const MAX_INCREASE_PERCENT = 1000;

const isPercent = (mode: ChangeMode) => mode === "increase_percent" || mode === "decrease_percent";

/** Reads the value typed for a rule. Returns the value (see PriceRule.value), or an error text. */
export function parseRuleValue(mode: ChangeMode, text: string): number | string {
  const trimmed = text.trim();
  if (!trimmed) return isPercent(mode) ? "Oranı yazın." : "Tutarı yazın.";
  if (isPercent(mode)) {
    const t = trimmed.replace(/^%\s*/, "").replace(",", ".");
    if (!/^\d+(\.\d{1,2})?$/.test(t)) return "Oran anlaşılamadı. Örnek: 10 veya 7,5";
    const hundredths = Math.round(Number(t) * 100);
    if (hundredths <= 0) return "Oran sıfırdan büyük olmalı.";
    if (mode === "decrease_percent" && hundredths >= 100 * 100) return "İndirim oranı 100'den küçük olmalı.";
    if (hundredths > MAX_INCREASE_PERCENT * 100) return `Oran en fazla ${MAX_INCREASE_PERCENT} olabilir.`;
    return hundredths;
  }
  if (trimmed.startsWith("-")) return "Tutar eksi olamaz. Düşmek için \"Tutar düş\" seçin.";
  const kurus = parseMoney(trimmed);
  if (kurus === null) return "Tutar anlaşılamadı. Örnek: 2,50";
  if (kurus <= 0) return "Tutar sıfırdan büyük olmalı.";
  return kurus;
}

/** The new price for an old price, or an error text when the result is not a valid price. */
export function applyRule(old: number, rule: PriceRule): number | string {
  let value: number;
  switch (rule.mode) {
    case "set":
      return rule.value;
    case "increase_percent":
      value = Math.round((old * (10000 + rule.value)) / 10000);
      break;
    case "decrease_percent":
      value = Math.round((old * (10000 - rule.value)) / 10000);
      break;
    case "increase_amount":
      value = old + rule.value;
      break;
    case "decrease_amount":
      value = old - rule.value;
      break;
  }
  if (value < 0) return "Fiyat eksiye düşüyor.";
  if (rule.roundTo > 0) value = Math.ceil(value / rule.roundTo) * rule.roundTo;
  if (value > MAX_PRICE_KURUS) return `Fiyat ${formatMoney(MAX_PRICE_KURUS)} üstüne çıkıyor.`;
  return value;
}

/** Percent text without needless zeros: 1000 → "10", 750 → "7,5". */
const percentText = (hundredths: number) => (hundredths / 100).toLocaleString("tr-TR", { maximumFractionDigits: 2 });

/** Short Turkish text for the rule, for the confirm question and the history ("satış fiyatı: %10 artış"). */
export function describeRule(rule: PriceRule, fields: readonly PriceField[]): string {
  const change = {
    increase_percent: `%${percentText(rule.value)} artış`,
    decrease_percent: `%${percentText(rule.value)} indirim`,
    increase_amount: `${formatMoney(rule.value)} artış`,
    decrease_amount: `${formatMoney(rule.value)} indirim`,
    set: `yeni fiyat ${formatMoney(rule.value)}`,
  }[rule.mode];
  const rounding = rule.mode !== "set" && rule.roundTo > 0 ? `, ${formatMoney(rule.roundTo)} katına yukarı yuvarlama` : "";
  const names = fields.map((f) => PRICE_FIELD_NAMES[f].toLocaleLowerCase("tr-TR")).join(", ");
  return `${names}: ${change}${rounding}`;
}

export interface PriceChange {
  product_id: number;
  field: PriceField;
  old_kurus: number;
  new_kurus: number;
}

type PricedProduct = { id: number; name: string } & { [F in PriceField]: number | null };

/**
 * Applies the rule to the chosen prices of the products. A price that the product does not
 * have (no helium price, no purchase price) is skipped. A price that stays the same is skipped.
 */
export function planPriceChanges(
  products: readonly PricedProduct[],
  fields: readonly PriceField[],
  rule: PriceRule,
): { changes: PriceChange[]; errors: { product_id: number; name: string; field: PriceField; message: string }[] } {
  const changes: PriceChange[] = [];
  const errors: { product_id: number; name: string; field: PriceField; message: string }[] = [];
  for (const p of products) {
    for (const field of fields) {
      const old = p[field];
      if (old === null) continue;
      const next = applyRule(old, rule);
      if (typeof next === "string") errors.push({ product_id: p.id, name: p.name, field, message: next });
      else if (next !== old) changes.push({ product_id: p.id, field, old_kurus: old, new_kurus: next });
    }
  }
  return { changes, errors };
}
