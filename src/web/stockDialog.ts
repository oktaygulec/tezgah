// "Stok" dialog for one product: add, remove or set the stock, with an optional note, and the history.

import { formatDateTime } from "../shared/time";
import {
  MAX_STOCK_NOTE_LENGTH,
  parseQuantity,
  STOCK_MODE_LABELS,
  STOCK_REASON_LABELS,
  stockChange,
  stockQuantityError,
  type StockMode,
  type StockMovement,
} from "../shared/stock";
import type { Product } from "../shared/types";
import { api } from "./api";
import { errorMessage, h, openDialog } from "./ui";

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

function historyTable(movements: StockMovement[]): HTMLElement {
  if (movements.length === 0) return h("div", { class: "muted" }, "Henüz stok hareketi yok.");
  return h(
    "div",
    { class: "stock-history" },
    h(
      "table",
      { class: "table" },
      h("thead", {}, h("tr", {}, h("th", {}, "Tarih"), h("th", {}, "İşlem"), h("th", { class: "num" }, "Değişim"), h("th", { class: "num" }, "Stok"), h("th", {}, "Not"))),
      h(
        "tbody",
        {},
        ...movements.map((m) =>
          h(
            "tr",
            {},
            h("td", {}, formatDateTime(m.created_at)),
            h("td", {}, STOCK_REASON_LABELS[m.reason] ?? m.reason),
            h("td", { class: `num ${m.change < 0 ? "stock-minus" : "stock-plus"}` }, signed(m.change)),
            h("td", { class: "num" }, m.stock_after),
            h("td", { class: "small" }, m.order_no ? `Sipariş No ${m.order_no}` : m.note),
          ),
        ),
      ),
    ),
  );
}

/** Opens the stock dialog. Resolves with the updated product, or null when nothing was saved. */
export function openStockDialog(product: Product): Promise<Product | null> {
  return openDialog<Product>((close) => {
    let mode: StockMode = "add";
    const quantity = h("input", { class: "input input-number", inputMode: "numeric", autocomplete: "off", placeholder: "0" });
    const note = h("input", { class: "input", maxLength: MAX_STOCK_NOTE_LENGTH, placeholder: "İsteğe bağlı. Örnek: fatura no, tedarikçi" });
    const quantityError = h("div", { class: "field-error", role: "alert" });
    const result = h("div", { class: "stock-result" });
    const formError = h("div", { class: "form-error", role: "alert" });
    const saveButton = h("button", { type: "submit", class: "btn btn-primary" }, "Kaydet");
    const history = h("div", { class: "muted" }, "Geçmiş yükleniyor…");
    let touched = false;

    const modes = (Object.keys(STOCK_MODE_LABELS) as StockMode[]).map((m) => {
      const radio = h("input", { type: "radio", name: "stock-mode", value: m, checked: m === mode });
      radio.addEventListener("change", () => {
        mode = m;
        check();
        quantity.focus();
      });
      return h("label", { class: "check" }, radio, ` ${STOCK_MODE_LABELS[m]}`);
    });

    /** Shows the new stock, or the error. Returns the quantity when it is valid. */
    function check(): number | null {
      const q = parseQuantity(quantity.value);
      const error = quantity.value.trim() === "" && !touched ? null : stockQuantityError(mode, q);
      quantityError.textContent = error ?? "";
      quantity.classList.toggle("invalid", !!error);
      if (error || Number.isNaN(q)) {
        result.textContent = "";
        return null;
      }
      const after = product.stock_qty + stockChange(product.stock_qty, mode, q);
      result.replaceChildren("Yeni stok: ", h("strong", { class: after <= 0 ? "stock-low" : "" }, after));
      return q;
    }
    quantity.addEventListener("input", check);
    quantity.addEventListener("blur", () => {
      // Leaving the box empty (for example to choose another mode) is not an error yet.
      if (quantity.value.trim() !== "") touched = true;
      check();
    });

    void api
      .stockMovements(product.id)
      .then((m) => history.replaceWith(historyTable(m)))
      .catch((e) => (history.textContent = `Geçmiş okunamadı: ${errorMessage(e)}`));

    const form = h(
      "form",
      {
        class: "form",
        novalidate: true,
        onsubmit: async (e: Event) => {
          e.preventDefault();
          touched = true;
          formError.textContent = "";
          const q = check();
          if (q === null) {
            quantity.focus();
            return;
          }
          saveButton.disabled = true;
          try {
            close(await api.adjustStock(product.id, { mode, quantity: q, note: note.value.trim() }));
          } catch (err) {
            formError.textContent = errorMessage(err);
          } finally {
            saveButton.disabled = false;
          }
        },
      },
      h("h2", {}, `Stok: ${product.name}`),
      h("div", { class: "stock-current" }, "Şu anki stok: ", h("strong", { class: product.stock_qty <= 0 ? "stock-low" : "" }, product.stock_qty), " adet"),
      h("div", { class: "stock-modes" }, ...modes),
      h("label", { class: "field" }, h("span", {}, "Miktar (adet)"), quantity, quantityError),
      result,
      h("label", { class: "field" }, h("span", {}, "Not"), note),
      formError,
      h("div", { class: "dialog-actions" }, h("button", { type: "button", class: "btn", onclick: () => close(null) }, "Kapat"), saveButton),
      h("h3", {}, "Stok geçmişi"),
      history,
    );
    setTimeout(() => quantity.focus(), 0);
    return [form];
  });
}
