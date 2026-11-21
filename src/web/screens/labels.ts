// Etiket: choose products and copy counts, preview one label, print.

import { formatMoney } from "../../shared/money";
import type { Product, Settings } from "../../shared/types";
import { api } from "../api";
import { labelElement, renderLabel, setPageSize, toPrintLabel, type LabelProduct } from "../label";
import { getSettings } from "../state";
import { h, run, toast, type Screen } from "../ui";
import { matchesSearch, sortByName } from "../search";

const MAX_ROWS = 300;
const SAMPLE: LabelProduct = { barcode: "2000000000015", name: "Örnek Ürün Adı Uzun Olabilir", price_kurus: 12950 };

/** productId → number of copies */
const selection = new Map<number, number>();

export function selectForLabel(productId: number) {
  selection.set(productId, Math.max(1, selection.get(productId) ?? 0));
}

/** Shows previews or warnings for one label. Used here and in Ayarlar. */
export function labelPreview(product: LabelProduct, settings: Settings = getSettings()): HTMLElement {
  try {
    const label = renderLabel(product, settings);
    const { warnings } = label;
    return h(
      "div",
      { class: "preview" },
      h("div", { class: "preview-label" }, labelElement(label, settings)),
      ...warnings.map((w) => h("div", { class: "field-warning" }, w)),
    );
  } catch (e) {
    return h("div", { class: "form-error" }, (e as Error).message);
  }
}

type PrintItem = { product: LabelProduct; copies: number };

/** Sends the labels straight to the printer chosen in Ayarlar (no print dialog). Returns the label count. */
export async function printDirect(items: PrintItem[]): Promise<number> {
  const settings = getSettings();
  const labels = items.map(({ product, copies }) => toPrintLabel(renderLabel(product, settings), copies));
  return (await api.print(labels)).count;
}

/** Opens the print-only view with one label per page and starts the browser print dialog. */
export function printLabels(items: PrintItem[]) {
  const settings = getSettings();
  const root = document.getElementById("print-root")!;
  const labels = h("div", { class: "print-labels" });
  for (const { product, copies } of items) {
    const label = renderLabel(product, settings);
    for (let i = 0; i < copies; i++) labels.append(labelElement(label, settings));
  }
  const close = () => {
    document.body.classList.remove("printing");
    root.replaceChildren();
    setPageSize(null);
  };
  root.replaceChildren(
    h(
      "div",
      { class: "print-toolbar no-print" },
      h("button", { class: "btn", onclick: close }, "← Geri"),
      h("button", { class: "btn btn-primary", onclick: () => window.print() }, "Tekrar Yazdır"),
      h("span", {}, `${labels.childElementCount} etiket. Yazıcı ayarı: kağıt ${settings.label_width_mm} x ${settings.label_height_mm} mm, kenar boşluğu "Yok", ölçek 100.`),
    ),
    labels,
  );
  setPageSize(settings);
  document.body.classList.add("printing");
  requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
}

export function createLabelsScreen(): Screen {
  let products: Product[] = [];

  const search = h("input", { class: "input", type: "search", placeholder: "Barkod veya ad ile ara…", autocomplete: "off" });
  search.addEventListener("input", renderList);
  const list = h("div", { class: "label-list" });
  const preview = h("div", { class: "label-preview" });
  const summary = h("div", { class: "strong" });
  const printButton = h("button", { class: "btn btn-primary btn-xl", onclick: () => run(print) }, "Yazdır");
  const browserButton = h("button", { class: "btn", onclick: () => run(() => printLabels(requireSelection())) }, "Tarayıcı ile yazdır");
  const printerInfo = h("div", { class: "muted small" });
  const clearButton = h("button", { class: "btn", onclick: () => { selection.clear(); render(); } }, "Seçimi temizle");

  async function load() {
    products = sortByName(await api.products());
    for (const id of selection.keys()) if (!products.some((p) => p.id === id)) selection.delete(id);
    render();
  }

  function selected(): { product: Product; copies: number }[] {
    return products.filter((p) => selection.has(p.id)).map((product) => ({ product, copies: selection.get(product.id)! }));
  }

  function requireSelection() {
    const items = selected();
    if (items.length === 0) throw new Error("Önce etiketlenecek ürünleri seçin.");
    return items;
  }

  /** One click: direct to the printer when one is chosen in Ayarlar, else the browser dialog. */
  async function print() {
    const items = requireSelection();
    if (!getSettings().printer_name) {
      printLabels(items);
      return;
    }
    printButton.disabled = true;
    try {
      const count = await printDirect(items);
      toast(`${count} etiket yazıcıya gönderildi.`, "success");
    } finally {
      printButton.disabled = false;
    }
  }

  function renderList() {
    // Selected products first, then the search results.
    const found = products.filter((p) => selection.has(p.id) || matchesSearch(p, search.value));
    found.sort((a, b) => Number(selection.has(b.id)) - Number(selection.has(a.id)));
    list.replaceChildren(
      ...found.slice(0, MAX_ROWS).map((p) => {
        const isSelected = selection.has(p.id);
        const copies = h("input", {
          class: "input input-copies",
          type: "number",
          min: 1,
          max: 999,
          value: selection.get(p.id) ?? 1,
          disabled: !isSelected,
          title: "Kopya sayısı",
        });
        copies.addEventListener("change", () => {
          const n = Math.min(999, Math.max(1, Math.floor(Number(copies.value)) || 1));
          copies.value = String(n);
          selection.set(p.id, n);
          renderSummary();
        });
        const check = h("input", { type: "checkbox", checked: isSelected });
        check.addEventListener("change", () => {
          if (check.checked) selection.set(p.id, Number(copies.value) || 1);
          else selection.delete(p.id);
          render();
        });
        return h(
          "div",
          { class: `label-row${isSelected ? " selected" : ""}` },
          h("label", { class: "label-pick" }, check, h("span", {}, p.name, h("span", { class: "muted small" }, ` ${p.barcode}`))),
          h("span", { class: "num" }, formatMoney(p.price_kurus)),
          copies,
        );
      }),
    );
    if (found.length === 0) list.append(h("div", { class: "empty" }, products.length ? "Aramaya uyan ürün yok." : "Henüz ürün yok."));
  }

  function renderSummary() {
    const items = selected();
    const count = items.reduce((n, i) => n + i.copies, 0);
    summary.textContent = items.length ? `${items.length} ürün, toplam ${count} etiket` : "Ürün seçilmedi";
    printButton.disabled = items.length === 0;
    browserButton.disabled = items.length === 0;
    const printer = getSettings().printer_name;
    printerInfo.textContent = printer
      ? `Yazıcı: ${printer} (doğrudan yazdırma)`
      : "Yazıcı seçilmedi: Yazdır, tarayıcının yazdırma penceresini açar. Ayarlar ekranından yazıcı seçin.";
    preview.replaceChildren(
      h("div", { class: "muted" }, items.length ? "Önizleme (gerçek boyut):" : "Örnek önizleme (gerçek boyut):"),
      labelPreview(items[0]?.product ?? SAMPLE),
    );
  }

  function render() {
    renderList();
    renderSummary();
  }

  const el = h(
    "section",
    { class: "screen screen-labels" },
    h("div", { class: "labels-left" }, h("div", { class: "toolbar" }, search, clearButton), list),
    h("div", { class: "labels-right" }, preview, summary, printButton, printerInfo, browserButton),
  );

  return { id: "etiket", el, show: () => run(load) };
}
