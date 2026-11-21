// Azalan Stok: products at or below the low-stock limit (Ayarlar), lowest stock first,
// with the pieces sold in the last 30 days. The list can be downloaded as CSV for the supplier.

import { formatMoney, formatMoneyPlain } from "../../shared/money";
import type { LowStockItem } from "../../shared/types";
import { api } from "../api";
import { matchesSearch } from "../search";
import { getSettings } from "../state";
import { openStockDialog } from "../stockDialog";
import { h, run, toast, type Screen } from "../ui";

function csvField(value: string): string {
  return /[;"\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Order list for the supplier: barcode, name, stock, sold in 30 days, purchase price. */
function downloadCsv(items: LowStockItem[]) {
  const lines = ["barkod;ad;stok;son_30_gun_satis;alis_fiyati"];
  for (const p of items) {
    lines.push([csvField(p.barcode), csvField(p.name), p.stock_qty, p.sold_30d, p.cost_kurus === null ? "" : formatMoneyPlain(p.cost_kurus)].join(";"));
  }
  const blob = new Blob(["﻿" + lines.join("\r\n") + "\r\n"], { type: "text/csv;charset=utf-8" });
  const link = h("a", { href: URL.createObjectURL(blob), download: "azalan-stok.csv" });
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
}

export function createLowStockScreen(): Screen {
  let items: LowStockItem[] = [];

  const search = h("input", { class: "input", type: "search", placeholder: "Barkod veya ad ile ara…", autocomplete: "off" });
  search.addEventListener("input", render);
  const info = h("div", { class: "muted" });
  const tbody = h("tbody");
  const csvButton = h("button", { class: "btn", onclick: () => downloadCsv(shown()) }, "Sipariş listesi indir (CSV)");

  async function load() {
    items = await api.lowStock();
    render();
  }

  const shown = () => items.filter((p) => matchesSearch(p, search.value));

  async function changeStock(item: LowStockItem) {
    const updated = await openStockDialog(item);
    if (!updated) return;
    toast(`${updated.name}: stok ${updated.stock_qty} adet.`, "success");
    await load();
  }

  function render() {
    const list = shown();
    const limit = getSettings().low_stock_threshold;
    info.textContent = items.length
      ? `Stoğu ${limit} veya daha az olan ${items.length} ürün var.` + (list.length !== items.length ? ` Aramaya uyan: ${list.length}.` : "")
      : `Stoğu ${limit} veya daha az olan ürün yok.`;
    csvButton.disabled = list.length === 0;
    tbody.replaceChildren(
      ...list.map((p) =>
        h(
          "tr",
          {},
          h("td", { class: "mono" }, p.barcode),
          h("td", {}, p.name),
          h("td", { class: `num strong${p.stock_qty <= 0 ? " stock-low" : " stock-warn"}` }, p.stock_qty),
          h("td", { class: "num" }, p.sold_30d),
          h("td", { class: "num muted" }, p.cost_kurus === null ? "–" : formatMoney(p.cost_kurus)),
          h("td", { class: "actions" }, h("button", { class: "btn", onclick: () => run(() => changeStock(p)) }, "Stok")),
        ),
      ),
    );
    if (list.length === 0) tbody.append(h("tr", {}, h("td", { colSpan: 6, class: "empty" }, items.length ? "Aramaya uyan ürün yok." : "Bütün ürünlerin stoğu yeterli.")));
  }

  const el = h(
    "section",
    { class: "screen screen-lowstock" },
    h("div", { class: "toolbar" }, search, csvButton, h("button", { class: "btn", onclick: () => run(load) }, "Yenile")),
    info,
    h(
      "div",
      { class: "table-wrap" },
      h(
        "table",
        { class: "table" },
        h(
          "thead",
          {},
          h("tr", {}, h("th", {}, "Barkod"), h("th", {}, "Ad"), h("th", { class: "num" }, "Stok"), h("th", { class: "num" }, "Son 30 günde satılan"), h("th", { class: "num" }, "Alış"), h("th", {}, "")),
        ),
        tbody,
      ),
    ),
    h("p", { class: "muted small" }, "Sınır Ayarlar ekranındaki \"Azalan stok sınırı\" ile değiştirilir. Gelen malı Stok Girişi ekranından ekleyin."),
  );

  return { id: "azalan", el, show: () => run(load) };
}
