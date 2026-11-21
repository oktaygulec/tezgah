// Ürünler (under Yönetim): search, filter by category, add, edit, delete, stock, favorites.
// CSV import and export still work but their buttons are hidden for now.

import { formatMoney } from "../../shared/money";
import type { ImportResult, Product } from "../../shared/types";
import { api } from "../api";
import { thumbnail } from "../image";
import { categoryFilter } from "../categoryFilter";
import { categoryOf, loadCategories } from "../state";
import { openProductForm } from "../productForm";
import { confirmDialog, h, run, toast, type Screen } from "../ui";
import { matchesSearch, sortByName } from "../search";
import { openStockDialog } from "../stockDialog";
import { selectForLabel } from "./labels";

const MAX_ROWS = 500;

export function createProductsScreen(): Screen {
  let products: Product[] = [];

  const search = h("input", { class: "input", type: "search", placeholder: "Barkod veya ad ile ara…", autocomplete: "off" });
  search.addEventListener("input", render);
  const outOfStock = h("input", { type: "checkbox" });
  outOfStock.addEventListener("change", render);
  const favoritesOnly = h("input", { type: "checkbox" });
  favoritesOnly.addEventListener("change", render);
  const category = categoryFilter(render);
  const tbody = h("tbody");
  const info = h("div", { class: "muted" });
  const importReport = h("div", { class: "import-report", hidden: true });
  const fileInput = h("input", { type: "file", accept: ".csv,text/csv,text/plain", hidden: true });
  fileInput.addEventListener("change", () => run(importFile));

  async function load() {
    const [list] = await Promise.all([api.products(), loadCategories()]);
    products = sortByName(list);
    category.fill();
    render();
  }

  async function toggleFavorite(product: Product) {
    const updated = await api.setFavorite(product.id, product.favorite !== 1);
    products = products.map((p) => (p.id === updated.id ? updated : p));
    render();
  }

  async function add() {
    if (await openProductForm()) await load();
  }

  async function edit(product: Product) {
    if (await openProductForm({ product })) await load();
  }

  async function changeStock(product: Product) {
    const updated = await openStockDialog(product);
    if (!updated) return;
    toast(`${updated.name}: stok ${updated.stock_qty} adet.`, "success");
    await load();
  }

  async function remove(product: Product) {
    if (!(await confirmDialog(`"${product.name}" silinsin mi?`, "Evet, sil"))) return;
    await api.deleteProduct(product.id);
    toast("Ürün silindi.", "success");
    await load();
  }

  async function importFile() {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (!file) return;
    const result = await api.importCsv(await file.text());
    showImportReport(result);
    await load();
  }

  function showImportReport(r: ImportResult) {
    importReport.hidden = false;
    importReport.className = `import-report ${r.failed.length ? "notice-error" : "notice-success"}`;
    importReport.replaceChildren(
      h(
        "div",
        { class: "row" },
        h("strong", {}, `CSV: ${r.added} ürün eklendi, ${r.updated} ürün güncellendi, ${r.failed.length} satır hatalı.`),
        h("button", { class: "btn", onclick: () => (importReport.hidden = true) }, "Kapat"),
      ),
      ...(r.failed.length > 0
        ? [h("ul", {}, ...r.failed.map((f) => h("li", {}, `Satır ${f.line}: ${f.reason} — `, h("code", {}, f.text))))]
        : []),
    );
  }

  function render() {
    const found = products.filter(
      (p) => matchesSearch(p, search.value) && (!outOfStock.checked || p.stock_qty <= 0) && (!favoritesOnly.checked || p.favorite === 1) && category.matches(p),
    );
    const shown = found.slice(0, MAX_ROWS);
    tbody.replaceChildren(
      ...shown.map((p) =>
        h(
          "tr",
          {},
          h(
            "td",
            { class: "col-fav" },
            h(
              "button",
              {
                class: `btn-star${p.favorite ? " on" : ""}`,
                title: p.favorite ? "Favorilerden çıkar" : "Favorilere ekle",
                "aria-pressed": p.favorite ? "true" : "false",
                onclick: () => run(() => toggleFavorite(p)),
              },
              p.favorite ? "★" : "☆",
            ),
          ),
          h("td", { class: "col-thumb" }, thumbnail(p)),
          h("td", { class: "mono" }, p.barcode),
          h("td", {}, p.name, categoryOf(p.category_id) && h("div", { class: "muted small" }, categoryOf(p.category_id)!.name)),
          h("td", { class: "num muted" }, p.cost_kurus === null ? "–" : formatMoney(p.cost_kurus)),
          h(
            "td",
            { class: "num strong" },
            formatMoney(p.price_kurus),
            p.helium_price_kurus !== null && h("div", { class: "small helium-price" }, `Helyumlu ${formatMoney(p.helium_price_kurus)}`),
          ),
          h("td", { class: `num strong${p.stock_qty <= 0 ? " stock-low" : ""}` }, p.stock_qty),
          h(
            "td",
            { class: "actions" },
            h("button", { class: "btn", onclick: () => run(() => changeStock(p)) }, "Stok"),
            h("button", { class: "btn", onclick: () => run(() => edit(p)) }, "Düzenle"),
            h(
              "button",
              {
                class: "btn",
                onclick: () => {
                  selectForLabel(p.id);
                  location.hash = "#etiket";
                },
              },
              "Barkod yazdır",
            ),
            h("button", { class: "btn btn-danger-outline", onclick: () => run(() => remove(p)) }, "Sil"),
          ),
        ),
      ),
    );
    if (shown.length === 0) {
      tbody.append(h("tr", {}, h("td", { colSpan: 8, class: "empty" }, products.length ? "Aramaya uyan ürün yok." : "Henüz ürün yok. \"Yeni Ürün\" ile ekleyin.")));
    }
    info.textContent =
      found.length > MAX_ROWS
        ? `${found.length} ürün bulundu, ilk ${MAX_ROWS} tanesi gösteriliyor. Aramayı daraltın.`
        : `${found.length} / ${products.length} ürün`;
  }

  const el = h(
    "section",
    { class: "screen screen-products" },
    h(
      "div",
      { class: "toolbar" },
      search,
      category.el,
      h("label", { class: "check" }, favoritesOnly, " Favoriler"),
      h("label", { class: "check" }, outOfStock, " Stoğu bitenler"),
      h("button", { class: "btn btn-primary", onclick: () => run(add) }, "Yeni Ürün"),
      // CSV buttons are hidden for now; remove "hidden" to show them again.
      h("button", { class: "btn", hidden: true, onclick: () => fileInput.click() }, "CSV İçe Aktar"),
      h("a", { class: "btn", hidden: true, href: "/api/products/export", download: "urunler.csv" }, "CSV Dışa Aktar"),
      fileInput,
    ),
    importReport,
    info,
    h(
      "div",
      { class: "table-wrap" },
      h(
        "table",
        { class: "table" },
        h("thead", {}, h("tr", {}, h("th", { title: "Favori" }, "★"), h("th", {}, ""), h("th", {}, "Barkod"), h("th", {}, "Ad"), h("th", { class: "num" }, "Alış"), h("th", { class: "num" }, "Satış"), h("th", { class: "num" }, "Stok"), h("th", {}, ""))),
        tbody,
      ),
    ),
  );

  return { id: "urunler", el, show: () => run(load) };
}
