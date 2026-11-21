// Add / edit product dialog, used by Ürünler and by Satış for unknown barcodes.

import { ean13Warning } from "../shared/barcode";
import { formatMoneyPlain, parseMoney } from "../shared/money";
import type { Product } from "../shared/types";
import { api } from "./api";
import { errorMessage, h, openDialog } from "./ui";

export function openProductForm(opts: { product?: Product; barcode?: string } = {}): Promise<Product | null> {
  const { product } = opts;
  return openDialog<Product>((close) => {
    const barcode = h("input", {
      class: "input",
      name: "barcode",
      autocomplete: "off",
      value: product?.barcode ?? opts.barcode ?? "",
      required: true,
    });
    const name = h("input", { class: "input", name: "name", autocomplete: "off", value: product?.name ?? "", required: true });
    const price = h("input", {
      class: "input",
      name: "price",
      inputMode: "decimal",
      autocomplete: "off",
      placeholder: "12,50",
      value: product ? formatMoneyPlain(product.price_kurus) : "",
      required: true,
    });
    const barcodeWarning = h("div", { class: "field-warning" });
    const formError = h("div", { class: "form-error", role: "alert" });
    const saveButton = h("button", { type: "submit", class: "btn btn-primary" }, "Kaydet");

    const checkBarcode = () => {
      barcodeWarning.textContent = ean13Warning(barcode.value.trim()) ?? "";
    };
    barcode.addEventListener("input", checkBarcode);
    checkBarcode();

    // The scanner types the code and presses Enter: move on instead of submitting.
    const enterMovesTo = (from: HTMLInputElement, to: HTMLInputElement) =>
      from.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          to.focus();
          to.select();
        }
      });
    enterMovesTo(barcode, name);
    enterMovesTo(name, price);

    const generate = h(
      "button",
      {
        type: "button",
        class: "btn",
        onclick: async () => {
          formError.textContent = "";
          try {
            barcode.value = (await api.nextBarcode()).barcode;
            checkBarcode();
            name.focus();
          } catch (e) {
            formError.textContent = errorMessage(e);
          }
        },
      },
      "Barkod oluştur",
    );

    const form = h(
      "form",
      {
        class: "form",
        onsubmit: async (e: Event) => {
          e.preventDefault();
          formError.textContent = "";
          const kurus = parseMoney(price.value);
          if (kurus === null) {
            formError.textContent = "Fiyat anlaşılamadı. Örnek: 12,50";
            price.focus();
            return;
          }
          const input = { barcode: barcode.value.trim(), name: name.value.trim(), price_kurus: kurus };
          saveButton.disabled = true;
          try {
            close(product ? await api.updateProduct(product.id, input) : await api.createProduct(input));
          } catch (err) {
            formError.textContent = errorMessage(err);
          } finally {
            saveButton.disabled = false;
          }
        },
      },
      h("h2", {}, product ? "Ürünü Düzenle" : "Yeni Ürün"),
      h("label", { class: "field" }, h("span", {}, "Barkod"), h("div", { class: "row" }, barcode, generate)),
      barcodeWarning,
      h("label", { class: "field" }, h("span", {}, "Ürün adı"), name),
      h("label", { class: "field" }, h("span", {}, "Fiyat (₺)"), price),
      formError,
      h(
        "div",
        { class: "dialog-actions" },
        h("button", { type: "button", class: "btn", onclick: () => close(null) }, "Vazgeç"),
        saveButton,
      ),
    );

    // Focus the first empty field once the dialog is open.
    setTimeout(() => (barcode.value ? (name.value ? price : name) : barcode).focus(), 0);
    return [form];
  });
}
