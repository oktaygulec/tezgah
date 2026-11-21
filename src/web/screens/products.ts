// Ürünler: search, add, edit, delete, CSV import and export.

import { formatMoney } from "../../shared/money";
import type { ImportResult, Product } from "../../shared/types";
import { api } from "../api";
import { openProductForm } from "../productForm";
import { confirmDialog, h, run, toast, type Screen } from "../ui";
import { matchesSearch, sortByName } from "../search";
import { selectForLabel } from "./labels";

const MAX_ROWS = 500;

export function createProductsScreen(): Screen {
  let products: Product[] = [];

  const search = h("input", { class: "input", type: "search", placeholder: "Barkod veya ad ile ara…", autocomplete: "off" });
  search.addEventListener("input", render);
  const tbody = h("tbody");
  const info = h("div", { class: "muted" });
  const importReport = h("div", { class: "import-report", hidden: true });
  const fileInput = h("input", { type: "file", accept: ".csv,text/csv,text/plain", hidden: true });
  fileInput.addEventListener("change", () => run(importFile));

  async function load() {
    products = sortByName(await api.products());
    render();
  }

  async function add() {
    if (await openProductForm()) await load();
  }

  async function edit(product: Product) {
    if (await openProductForm({ product })) await load();
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
    const found = products.filter((p) => matchesSearch(p, search.value));
    const shown = found.slice(0, MAX_ROWS);
    tbody.replaceChildren(
      ...shown.map((p) =>
        h(
          "tr",
          {},
          h("td", { class: "mono" }, p.barcode),
          h("td", {}, p.name),
          h("td", { class: "num strong" }, formatMoney(p.price_kurus)),
          h(
            "td",
            { class: "actions" },
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
              "Bu ürünü etiketle",
            ),
            h("button", { class: "btn btn-danger-outline", onclick: () => run(() => remove(p)) }, "Sil"),
          ),
        ),
      ),
    );
    if (shown.length === 0) {
      tbody.append(h("tr", {}, h("td", { colSpan: 4, class: "empty" }, products.length ? "Aramaya uyan ürün yok." : "Henüz ürün yok. \"Yeni Ürün\" ile ekleyin.")));
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
      h("button", { class: "btn btn-primary", onclick: () => run(add) }, "Yeni Ürün"),
      h("button", { class: "btn", onclick: () => fileInput.click() }, "CSV İçe Aktar"),
      h("a", { class: "btn", href: "/api/products/export", download: "urunler.csv" }, "CSV Dışa Aktar"),
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
        h("thead", {}, h("tr", {}, h("th", {}, "Barkod"), h("th", {}, "Ad"), h("th", { class: "num" }, "Fiyat"), h("th", {}, ""))),
        tbody,
      ),
    ),
  );

  return { id: "urunler", el, show: () => run(load) };
}
