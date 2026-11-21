// Toplu Fiyat (under Yönetim): choose products, give a change (percent or amount, with rounding),
// check the new prices in the list, then save them all at once. The last change can be undone.

import {
  describeRule,
  parseRuleValue,
  planPriceChanges,
  PRICE_FIELD_NAMES,
  type ChangeMode,
  type PriceChange,
  type PriceField,
  type PriceRule,
} from "../../shared/bulkPrice";
import { formatMoney } from "../../shared/money";
import { formatDateTime } from "../../shared/time";
import type { PriceBatch, Product } from "../../shared/types";
import { api } from "../api";
import { categoryFilter } from "../categoryFilter";
import { matchesSearch, sortByName } from "../search";
import { categoryOf, loadCategories } from "../state";
import { confirmDialog, h, run, type Screen } from "../ui";
import { selectForLabel } from "./labels";

const MODES: [ChangeMode, string][] = [
  ["increase_percent", "Yüzde artır (%)"],
  ["decrease_percent", "Yüzde indir (%)"],
  ["increase_amount", "Tutar ekle (₺)"],
  ["decrease_amount", "Tutar düş (₺)"],
  ["set", "Yeni fiyat ver (₺)"],
];

const ROUNDINGS: [number, string][] = [
  [0, "Yuvarlama yok"],
  [50, "50 kuruşa yukarı"],
  [100, "1 TL'ye yukarı"],
  [500, "5 TL'ye yukarı"],
  [1000, "10 TL'ye yukarı"],
];

interface Plan {
  rule: PriceRule;
  fields: PriceField[];
  included: Product[];
  changes: PriceChange[];
  /** "productId:field" → new price */
  newPrice: Map<string, number>;
  /** "productId:field" → error text */
  errors: Map<string, string>;
  productCount: number;
}

export function createBulkPricesScreen(): Screen {
  let products: Product[] = [];
  let lastBatch: PriceBatch | null = null;
  /** Products that the user took out of the change (unchecked rows). */
  const skipped = new Set<number>();

  const search = h("input", { class: "input", type: "search", placeholder: "Barkod veya ad ile ara…", autocomplete: "off" });
  search.addEventListener("input", schedule);
  const category = categoryFilter(schedule);
  const favoritesOnly = h("input", { type: "checkbox" });
  favoritesOnly.addEventListener("change", schedule);
  const info = h("div", { class: "muted" });

  const mode = h("select", { class: "input input-auto", "aria-label": "Değişiklik" }, ...MODES.map(([v, text]) => h("option", { value: v }, text)));
  const value = h("input", { class: "input input-number", autocomplete: "off", inputMode: "decimal", "aria-label": "Oran veya tutar" });
  const rounding = h("select", { class: "input input-auto", "aria-label": "Yuvarlama" }, ...ROUNDINGS.map(([v, text]) => h("option", { value: String(v) }, text)));
  const fieldBoxes: Record<PriceField, HTMLInputElement> = {
    price_kurus: h("input", { type: "checkbox", checked: true }),
    helium_price_kurus: h("input", { type: "checkbox", checked: true }),
    cost_kurus: h("input", { type: "checkbox" }),
  };
  const heliumField = h("label", { class: "check" }, fieldBoxes.helium_price_kurus, ` ${PRICE_FIELD_NAMES.helium_price_kurus}`);
  const valueError = h("div", { class: "field-error", role: "alert" });
  for (const input of [mode, rounding, ...Object.values(fieldBoxes)]) input.addEventListener("change", schedule);
  value.addEventListener("input", schedule);
  mode.addEventListener("change", () => {
    value.placeholder = mode.value.endsWith("percent") ? "Örn. 10" : "Örn. 2,50";
    rounding.disabled = mode.value === "set";
  });
  value.placeholder = "Örn. 10";

  const allBox = h("input", { type: "checkbox", title: "Listedekilerin hepsini seç veya bırak", "aria-label": "Hepsini seç" });
  allBox.addEventListener("change", () => {
    for (const p of found()) allBox.checked ? skipped.delete(p.id) : skipped.add(p.id);
    schedule();
  });
  const heliumHead = h("th", { class: "num" }, "Helyumlu");
  const tbody = h("tbody");

  const lastBar = h("div", { class: "notice notice-info", hidden: true });
  const result = h("div", { class: "notice", hidden: true });
  const warning = h("div", { class: "notice notice-warning", hidden: true });
  const summary = h("div", { class: "stockin-summary" });
  const applyButton = h("button", { class: "btn btn-primary btn-xl", onclick: () => run(apply) }, "Fiyatları Güncelle");

  /** Shows the helium column and box only when some product has a helium price. */
  const hasHelium = () => products.some((p) => p.helium_price_kurus !== null);

  function found(): Product[] {
    return products.filter((p) => matchesSearch(p, search.value) && (!favoritesOnly.checked || p.favorite === 1) && category.matches(p));
  }

  function selectedFields(): PriceField[] {
    return (Object.keys(fieldBoxes) as PriceField[]).filter((f) => fieldBoxes[f].checked && (f !== "helium_price_kurus" || hasHelium()));
  }

  /** The rule from the form; an error text when the typed value is wrong; null when no value is typed. */
  function readRule(): PriceRule | string | null {
    if (!value.value.trim()) return null;
    const m = mode.value as ChangeMode;
    const parsed = parseRuleValue(m, value.value);
    if (typeof parsed === "string") return parsed;
    return { mode: m, value: parsed, roundTo: m === "set" ? 0 : Number(rounding.value) };
  }

  function makePlan(list: Product[]): Plan | string | null {
    const rule = readRule();
    if (rule === null || typeof rule === "string") return rule;
    const fields = selectedFields();
    if (fields.length === 0) return "Değişecek fiyatı seçin (satış, helyumlu veya alış).";
    const included = list.filter((p) => !skipped.has(p.id));
    const { changes, errors } = planPriceChanges(included, fields, rule);
    return {
      rule,
      fields,
      included,
      changes,
      newPrice: new Map(changes.map((c) => [`${c.product_id}:${c.field}`, c.new_kurus])),
      errors: new Map(errors.map((e) => [`${e.product_id}:${e.field}`, e.message])),
      productCount: new Set(changes.map((c) => c.product_id)).size,
    };
  }

  async function load() {
    const [list, last] = await Promise.all([api.products(), api.lastPriceBatch(), loadCategories()]);
    products = sortByName(list);
    lastBatch = last;
    category.fill();
    render();
  }

  function labelsButton(productIds: number[]) {
    return h(
      "button",
      {
        class: "btn",
        onclick: () => {
          for (const id of productIds) selectForLabel(id);
          location.hash = "#etiket";
        },
      },
      `Etiketleri Yazdır (${productIds.length} ürün)`,
    );
  }

  function showResult(text: string, productIds: number[]) {
    result.className = "notice notice-success";
    result.replaceChildren(h("span", {}, text), ...(productIds.length > 0 ? [labelsButton(productIds)] : []));
    result.hidden = false;
  }

  async function apply() {
    const plan = makePlan(found());
    if (plan === null || typeof plan === "string" || plan.errors.size > 0 || plan.changes.length === 0) return;
    const description = describeRule(plan.rule, plan.fields);
    const ok = await confirmDialog(`${plan.productCount} ürünün fiyatı değişecek (${description}). Devam edilsin mi?`, "Evet, güncelle", false);
    if (!ok) return;
    applyButton.disabled = true;
    try {
      const saved = await api.applyPriceChanges(plan.changes, description);
      // Empty the box, so that a second click cannot apply the same change again.
      value.value = "";
      showResult(`${saved.product_ids.length} ürünün fiyatı güncellendi. Raflardaki etiketleri yenilemeyi unutmayın.`, saved.product_ids);
    } finally {
      applyButton.disabled = false;
    }
    await load();
  }

  async function undo() {
    if (!lastBatch) return;
    const ok = await confirmDialog(
      `Son toplu değişiklik geri alınsın mı? (${formatDateTime(lastBatch.created_at)}, ${lastBatch.description}) Bu değişiklikten sonra elle değiştirilen fiyatlar olduğu gibi kalır.`,
      "Evet, geri al",
    );
    if (!ok) return;
    const r = await api.undoPriceBatch(lastBatch.id);
    const kept = r.skipped > 0 ? ` ${r.skipped} fiyat sonradan değiştiği için olduğu gibi kaldı.` : "";
    showResult(`${r.restored} fiyat eski haline döndü.${kept}`, r.product_ids);
    await load();
  }

  function priceCell(p: Product, field: PriceField, plan: Plan | null, included: boolean) {
    const old = p[field];
    if (old === null) return h("td", { class: "num muted" }, "–");
    const key = `${p.id}:${field}`;
    const error = included ? plan?.errors.get(key) : undefined;
    if (error) return h("td", { class: "num" }, formatMoney(old), h("div", { class: "field-error small" }, error));
    const next = included ? plan?.newPrice.get(key) : undefined;
    if (next === undefined) return h("td", { class: `num${plan && plan.fields.includes(field) && included ? "" : " muted"}` }, formatMoney(old));
    return h(
      "td",
      { class: "num" },
      h("span", { class: "price-old" }, formatMoney(old)),
      h("span", { class: "price-arrow" }, " → "),
      h("span", { class: "price-new" }, formatMoney(next)),
    );
  }

  let pending = false;
  function schedule() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      render();
    });
  }

  function render() {
    const list = found();
    const planOrError = makePlan(list);
    const plan = typeof planOrError === "object" ? planOrError : null;
    const helium = hasHelium();
    heliumField.hidden = !helium;
    heliumHead.hidden = !helium;
    valueError.textContent = typeof planOrError === "string" ? planOrError : "";
    value.classList.toggle("invalid", typeof planOrError === "string" && value.value.trim() !== "");

    tbody.replaceChildren(
      ...list.map((p) => {
        const included = !skipped.has(p.id);
        const box = h("input", { type: "checkbox", checked: included, "aria-label": `${p.name} değişsin` });
        box.addEventListener("change", () => {
          box.checked ? skipped.delete(p.id) : skipped.add(p.id);
          schedule();
        });
        const cat = categoryOf(p.category_id);
        return h(
          "tr",
          { class: included ? "" : "row-skipped" },
          h("td", { class: "col-check" }, box),
          h("td", {}, h("div", { class: "strong" }, p.name), h("div", { class: "muted small" }, p.barcode, cat && ` · ${cat.name}`)),
          priceCell(p, "price_kurus", plan, included),
          helium && priceCell(p, "helium_price_kurus", plan, included),
          priceCell(p, "cost_kurus", plan, included),
        );
      }),
    );
    if (list.length === 0) {
      tbody.append(h("tr", {}, h("td", { colSpan: 5, class: "empty" }, products.length ? "Aramaya uyan ürün yok." : "Henüz ürün yok.")));
    }
    const includedCount = list.filter((p) => !skipped.has(p.id)).length;
    allBox.checked = list.length > 0 && includedCount === list.length;
    allBox.indeterminate = includedCount > 0 && includedCount < list.length;
    info.textContent = `${list.length} / ${products.length} ürün listede, ${includedCount} ürün seçili`;

    if (plan && plan.errors.size > 0) {
      const [key, message] = [...plan.errors][0]!;
      const [id, field] = key.split(":") as [string, PriceField];
      const name = products.find((p) => p.id === Number(id))?.name ?? "";
      warning.textContent = `${plan.errors.size} fiyat geçersiz olur. Örnek: "${name}", ${PRICE_FIELD_NAMES[field].toLocaleLowerCase("tr-TR")}: ${message} Değişikliği düzeltin veya bu ürünlerin işaretini kaldırın.`;
      warning.hidden = false;
    } else {
      warning.hidden = true;
    }

    summary.replaceChildren(
      h("span", {}, "DEĞİŞECEK"),
      h("strong", {}, plan ? `${plan.productCount} ürün` : "–"),
      h("span", { class: "small" }, plan ? `${plan.changes.length} fiyat` : "Oran veya tutar yazın"),
    );
    applyButton.disabled = !plan || plan.errors.size > 0 || plan.changes.length === 0;

    lastBar.hidden = !lastBatch;
    if (lastBatch) {
      lastBar.replaceChildren(
        h("span", {}, `Son toplu değişiklik: ${formatDateTime(lastBatch.created_at)} · ${lastBatch.description} · ${lastBatch.product_count} ürün`),
        h("button", { class: "btn", onclick: () => run(undo) }, "Geri Al"),
      );
    }
  }

  const el = h(
    "section",
    { class: "screen screen-bulkprices" },
    lastBar,
    result,
    h(
      "div",
      { class: "bulk-rule" },
      h(
        "div",
        { class: "bulk-rule-row" },
        h("span", { class: "strong" }, "1. Değişiklik:"),
        mode,
        value,
        rounding,
      ),
      h(
        "div",
        { class: "bulk-rule-row" },
        h("span", { class: "strong" }, "2. Değişecek fiyatlar:"),
        h("label", { class: "check" }, fieldBoxes.price_kurus, ` ${PRICE_FIELD_NAMES.price_kurus}`),
        heliumField,
        h("label", { class: "check" }, fieldBoxes.cost_kurus, ` ${PRICE_FIELD_NAMES.cost_kurus}`),
      ),
      valueError,
    ),
    h(
      "div",
      { class: "toolbar" },
      h("span", { class: "strong" }, "3. Ürünler:"),
      search,
      category.el,
      h("label", { class: "check" }, favoritesOnly, " Favoriler"),
      info,
    ),
    h(
      "div",
      { class: "table-wrap" },
      h(
        "table",
        { class: "table" },
        h(
          "thead",
          {},
          h("tr", {}, h("th", { class: "col-check" }, allBox), h("th", {}, "Ürün"), h("th", { class: "num" }, "Satış"), heliumHead, h("th", { class: "num" }, "Alış")),
        ),
        tbody,
      ),
    ),
    warning,
    h("footer", { class: "sale-footer" }, summary, applyButton),
  );

  return { id: "toplu-fiyat", el, show: () => run(load) };
}
