// Raporlar: sales totals and gross profit per day / week / month / year, compared with the previous
// period; a breakdown table; best-selling products; current stock value; products that did not sell.

import { formatMoney } from "../../shared/money";
import { PERIOD_LABELS, percentChange, periodFor, shiftPeriod, type PeriodKind } from "../../shared/report";
import { istanbulDay } from "../../shared/time";
import type { ReportTotals, SalesReport, TopProduct } from "../../shared/types";
import { api } from "../api";
import { h, run, type Screen } from "../ui";

type SortKey = "pieces" | "revenue_kurus" | "profit_kurus";
const SORTS: [SortKey, string][] = [
  ["pieces", "Adet"],
  ["revenue_kurus", "Ciro"],
  ["profit_kurus", "Kâr"],
];
const TOP_ROWS = 10;

const pct = (n: number) => `%${n.toFixed(1).replace(".", ",")}`;

/** Profit margin over the revenue whose purchase price is known; null when there is none. */
function margin(t: ReportTotals): number | null {
  const known = t.revenue_kurus - t.unknown_cost_revenue_kurus;
  return known > 0 ? (t.profit_kurus / known) * 100 : null;
}

function changeBadge(current: number, previous: number) {
  const change = percentChange(current, previous);
  if (change === null) return h("span", { class: "change muted" }, "önceki dönem: –");
  const cls = change > 0 ? "change up" : change < 0 ? "change down" : "change muted";
  return h("span", { class: cls }, `${change > 0 ? "▲" : change < 0 ? "▼" : "="} ${pct(Math.abs(change))} önceki döneme göre`);
}

function card(title: string, value: string, ...extra: (Node | string | false)[]) {
  return h("div", { class: "report-card" }, h("div", { class: "report-card-title" }, title), h("div", { class: "report-card-value" }, value), ...extra.filter((x): x is Node | string => x !== false));
}

export function createReportsScreen(): Screen {
  let kind: PeriodKind = "month";
  let report: SalesReport | null = null;
  let sortKey: SortKey = "pieces";
  let showAll = false;

  const dateInput = h("input", { class: "input input-date", type: "date", value: istanbulDay() });
  dateInput.addEventListener("change", () => run(load));
  const kindButtons = (Object.keys(PERIOD_LABELS) as PeriodKind[]).map((k) =>
    h("button", { class: "btn", "data-kind": k, onclick: () => { kind = k; void run(load); } }, PERIOD_LABELS[k]),
  );
  const title = h("h2", { class: "report-title" });
  const body = h("div", { class: "report-body" });

  function move(step: -1 | 1) {
    const p = shiftPeriod(periodFor(kind, dateInput.value || istanbulDay()), step);
    dateInput.value = p.start;
    void run(load);
  }

  async function load() {
    if (!dateInput.value) dateInput.value = istanbulDay();
    for (const b of kindButtons) b.classList.toggle("btn-primary", b.dataset.kind === kind);
    report = await api.salesReport(kind, dateInput.value);
    render();
  }

  function render() {
    if (!report) return;
    const r = report;
    const t = r.totals;
    const p = r.previous_totals;
    title.replaceChildren(r.period.label, h("span", { class: "muted small" }, `  Önceki dönem: ${r.previous.label}`));

    const m = margin(t);
    const cards = h(
      "div",
      { class: "report-cards" },
      card("Ciro", formatMoney(t.revenue_kurus), changeBadge(t.revenue_kurus, p.revenue_kurus)),
      card("Brüt kâr", formatMoney(t.profit_kurus), m !== null && h("span", { class: "muted" }, `Kâr marjı ${pct(m)}`), changeBadge(t.profit_kurus, p.profit_kurus)),
      card("Alış maliyeti", formatMoney(t.cost_kurus)),
      card("Sipariş", String(t.orders), changeBadge(t.orders, p.orders)),
      card("Satılan adet", String(t.pieces), changeBadge(t.pieces, p.pieces)),
      card("Ortalama sepet", t.orders ? formatMoney(Math.round(t.revenue_kurus / t.orders)) : "–"),
      card("İptal edilen", String(t.cancelled_orders), t.cancelled_orders > 0 && h("span", { class: "muted" }, formatMoney(t.cancelled_kurus))),
    );
    const unknownNote =
      t.unknown_cost_revenue_kurus > 0 &&
      h(
        "div",
        { class: "notice notice-warning" },
        `${formatMoney(t.unknown_cost_revenue_kurus)} tutarındaki satışta ürünün alış fiyatı bilinmiyordu. Bu tutar kâra ve marja dahil değil. ` +
          "Ürünlere alış fiyatı girin; sonraki satışlar kâra dahil olur.",
      );

    // Breakdown with bars scaled to the largest revenue.
    const maxRevenue = Math.max(1, ...r.buckets.map((b) => b.revenue_kurus));
    const breakdown = h(
      "div",
      { class: "report-panel" },
      h("h3", {}, kind === "day" ? "Saatlere göre" : kind === "year" ? "Aylara göre" : "Günlere göre"),
      h(
        "div",
        { class: "table-scroll" },
        h(
          "table",
          { class: "table report-table" },
          h("thead", {}, h("tr", {}, h("th", {}, ""), h("th", {}, "Ciro"), h("th", { class: "num" }, "Kâr"), h("th", { class: "num" }, "Sipariş"))),
          h(
            "tbody",
            {},
            ...r.buckets.map((b) =>
              h(
                "tr",
                { class: b.orders ? "" : "empty-row" },
                h("td", { class: "nowrap" }, b.label),
                h(
                  "td",
                  { class: "bar-cell" },
                  h("div", { class: "bar", style: `width:${((b.revenue_kurus / maxRevenue) * 100).toFixed(1)}%` }),
                  h("span", {}, b.revenue_kurus ? formatMoney(b.revenue_kurus) : ""),
                ),
                h("td", { class: "num" }, b.revenue_kurus ? formatMoney(b.profit_kurus) : ""),
                h("td", { class: "num" }, b.orders || ""),
              ),
            ),
          ),
        ),
      ),
    );

    // Best sellers.
    const sorted = [...r.products].sort((a, b) => (b[sortKey] as number) - (a[sortKey] as number) || b.pieces - a.pieces);
    const rows = showAll ? sorted : sorted.slice(0, TOP_ROWS);
    const sortSelect = h("select", { class: "input input-sort" }, ...SORTS.map(([k, label]) => h("option", { value: k, selected: k === sortKey }, `Sırala: ${label}`)));
    sortSelect.addEventListener("change", () => {
      sortKey = sortSelect.value as SortKey;
      render();
    });
    const productRow = (p: TopProduct, i: number) =>
      h(
        "tr",
        {},
        h("td", { class: "num muted" }, i + 1),
        h("td", {}, p.name, h("div", { class: "muted small" }, p.barcode)),
        h("td", { class: "num strong" }, p.pieces),
        h("td", { class: "num" }, formatMoney(p.revenue_kurus)),
        h(
          "td",
          { class: "num" },
          // No known purchase price at all: the profit is unknown, not zero.
          p.unknown_cost && p.profit_kurus === 0 ? "–" : formatMoney(p.profit_kurus),
          p.unknown_cost ? h("span", { class: "muted", title: "Bazı satışlarda alış fiyatı bilinmiyordu" }, " *") : "",
        ),
      );
    const best = h(
      "div",
      { class: "report-panel" },
      h("div", { class: "panel-head" }, h("h3", {}, "En çok satan ürünler"), sortSelect),
      r.products.length
        ? h(
            "div",
            { class: "table-scroll" },
            h(
              "table",
              { class: "table" },
              h("thead", {}, h("tr", {}, h("th", {}, "#"), h("th", {}, "Ürün"), h("th", { class: "num" }, "Adet"), h("th", { class: "num" }, "Ciro"), h("th", { class: "num" }, "Kâr"))),
              h("tbody", {}, ...rows.map(productRow)),
            ),
          )
        : h("div", { class: "empty" }, "Bu dönemde satış yok."),
      r.products.length > TOP_ROWS &&
        h("button", { class: "btn", onclick: () => { showAll = !showAll; render(); } }, showAll ? `İlk ${TOP_ROWS} ürünü göster` : `Tümünü göster (${r.products.length})`),
      r.products.some((x) => x.unknown_cost) && h("div", { class: "muted small" }, "* Bazı satışlarda alış fiyatı bilinmiyordu; kâr eksik olabilir."),
    );

    // Stock value and products that did not sell.
    const s = r.stock;
    const stockPanel = h(
      "div",
      { class: "report-panel" },
      h("h3", {}, "Stok değeri (şu an)"),
      h(
        "div",
        { class: "report-cards small-cards" },
        card("Stoktaki adet", String(s.pieces)),
        card("Alış fiyatıyla", formatMoney(s.cost_value_kurus)),
        card("Satış fiyatıyla", formatMoney(s.sale_value_kurus)),
      ),
      s.products_without_cost > 0 && h("div", { class: "muted small" }, `${s.products_without_cost} stoklu ürünün alış fiyatı yok; alış değerine dahil değil.`),
    );
    const unsoldPanel = h(
      "div",
      { class: "report-panel" },
      h("h3", {}, "Bu dönemde hiç satılmayan stoklu ürünler"),
      r.unsold.length
        ? h(
            "div",
            { class: "table-scroll" },
            h(
              "table",
              { class: "table" },
              h("thead", {}, h("tr", {}, h("th", {}, "Ürün"), h("th", { class: "num" }, "Stok"), h("th", { class: "num" }, "Stok değeri"))),
              h(
                "tbody",
                {},
                ...r.unsold.map((u) =>
                  h(
                    "tr",
                    {},
                    h("td", {}, u.name, h("div", { class: "muted small" }, u.barcode)),
                    h("td", { class: "num" }, u.stock_qty),
                    h("td", { class: "num" }, formatMoney(u.stock_qty * (u.cost_kurus ?? u.price_kurus)), u.cost_kurus === null ? h("span", { class: "muted", title: "Satış fiyatıyla" }, " *") : ""),
                  ),
                ),
              ),
            ),
          )
        : h("div", { class: "empty" }, "Stoktaki her ürün bu dönemde en az bir kez satıldı."),
      r.unsold.some((u) => u.cost_kurus === null) && h("div", { class: "muted small" }, "* Alış fiyatı olmadığı için satış fiyatıyla hesaplandı."),
    );

    body.replaceChildren(
      cards,
      ...(unknownNote ? [unknownNote] : []),
      h("div", { class: "report-grid" }, breakdown, best),
      h("div", { class: "report-grid" }, stockPanel, unsoldPanel),
    );
  }

  const el = h(
    "section",
    { class: "screen screen-reports" },
    h(
      "div",
      { class: "toolbar" },
      h("div", { class: "segmented" }, ...kindButtons),
      h("button", { class: "btn", title: "Önceki dönem", onclick: () => move(-1) }, "◀"),
      dateInput,
      h("button", { class: "btn", title: "Sonraki dönem", onclick: () => move(1) }, "▶"),
      h("button", { class: "btn", onclick: () => { dateInput.value = istanbulDay(); void run(load); } }, "Bugün"),
    ),
    title,
    body,
  );

  return { id: "raporlar", el, show: () => run(load) };
}
