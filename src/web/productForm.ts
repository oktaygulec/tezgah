// Add / edit product dialog, used by Ürünler and by Satış for unknown barcodes.
// Each field shows its own error. A barcode that another product already uses is reported
// while typing or scanning, and the user can open that product instead.

import { ean13Warning } from "../shared/barcode";
import { formatMoney, formatMoneyPlain, parseMoney } from "../shared/money";
import type { Product } from "../shared/types";
import { barcodeError, MAX_BARCODE_LENGTH, MAX_NAME_LENGTH, nameError, priceTextError } from "../shared/validate";
import { api, findProduct } from "./api";
import { errorMessage, h, openDialog } from "./ui";

type FormResult = { saved: Product } | { editInstead: Product };

export async function openProductForm(opts: { product?: Product; barcode?: string } = {}): Promise<Product | null> {
  const result = await openProductDialog(opts);
  if (!result) return null;
  // "Mevcut ürünü düzenle": continue with the edit form of the existing product.
  if ("editInstead" in result) return openProductForm({ product: result.editInstead });
  return result.saved;
}

/** One input with its label, error line and optional hint line. */
function field(labelText: string, input: HTMLElement, extra?: HTMLElement) {
  const error = h("div", { class: "field-error", role: "alert" });
  const hint = h("div", { class: "field-warning" });
  const wrap = h("label", { class: "field" }, h("span", {}, labelText), input, error, hint, extra);
  return { wrap, error, hint };
}

function openProductDialog(opts: { product?: Product; barcode?: string }): Promise<FormResult | null> {
  const { product } = opts;
  return openDialog<FormResult>((close) => {
    const barcode = h("input", {
      class: "input",
      name: "barcode",
      autocomplete: "off",
      spellcheck: false,
      maxLength: MAX_BARCODE_LENGTH,
      value: product?.barcode ?? opts.barcode ?? "",
    });
    const name = h("input", { class: "input", name: "name", autocomplete: "off", maxLength: MAX_NAME_LENGTH, value: product?.name ?? "" });
    const price = h("input", {
      class: "input",
      name: "price",
      inputMode: "decimal",
      autocomplete: "off",
      placeholder: "12,50",
      value: product ? formatMoneyPlain(product.price_kurus) : "",
    });
    const formError = h("div", { class: "form-error", role: "alert" });
    const saveButton = h("button", { type: "submit", class: "btn btn-primary" }, "Kaydet");

    const generate = h("button", { type: "button", class: "btn", onclick: () => void generateBarcode() }, "Barkod oluştur");
    const duplicateBox = h("div", { class: "duplicate", hidden: true });
    const barcodeField = field("Barkod", h("div", { class: "row" }, barcode, generate), duplicateBox);
    const nameField = field("Ürün adı", name);
    const priceField = field("Fiyat (₺)", price);

    /** The product that already uses the typed barcode (another product), if any. */
    let duplicate: Product | null = null;
    let lookupNo = 0;
    /** Fields are checked after the user leaves them once, or after a save attempt. */
    const touched = new Set<HTMLInputElement>();

    function show(f: { error: HTMLElement }, input: HTMLInputElement, message: string | null) {
      const visible = touched.has(input) ? message : null;
      f.error.textContent = visible ?? "";
      input.classList.toggle("invalid", !!visible);
      input.setAttribute("aria-invalid", visible ? "true" : "false");
      return message;
    }

    function checkBarcode() {
      const code = barcode.value.trim();
      barcodeField.hint.textContent = ean13Warning(code) ?? "";
      return show(barcodeField, barcode, barcodeError(code) ?? (duplicate ? `Bu barkod başka bir üründe kayıtlı.` : null));
    }
    const checkName = () => show(nameField, name, nameError(name.value.trim()));
    function checkPrice() {
      const error = priceTextError(price.value);
      priceField.hint.textContent = !error && parseMoney(price.value) === 0 ? "Fiyat ₺0,00. Doğru mu?" : "";
      return show(priceField, price, error);
    }
    const checkAll = () => [checkBarcode(), checkName(), checkPrice()];

    function renderDuplicate() {
      duplicateBox.hidden = !duplicate;
      if (!duplicate) return duplicateBox.replaceChildren();
      const existing = duplicate;
      duplicateBox.replaceChildren(
        h("div", {}, "Kayıtlı ürün: ", h("strong", {}, existing.name), ` — ${formatMoney(existing.price_kurus)}`),
        h("button", { type: "button", class: "btn", onclick: () => close({ editInstead: existing }) }, "Mevcut ürünü düzenle"),
      );
    }

    /** Looks up the barcode on the server; only the newest lookup counts. */
    async function lookupBarcode() {
      const code = barcode.value.trim();
      const no = ++lookupNo;
      let found: Product | null = null;
      if (code && !barcodeError(code)) {
        try {
          found = await findProduct(code);
        } catch (e) {
          formError.textContent = `Barkod kontrol edilemedi: ${errorMessage(e)}`;
        }
      }
      if (no !== lookupNo) return;
      duplicate = found && found.id !== product?.id ? found : null;
      if (duplicate) touched.add(barcode);
      renderDuplicate();
      checkBarcode();
    }

    let lookupTimer: ReturnType<typeof setTimeout> | undefined;
    barcode.addEventListener("input", () => {
      duplicate = null;
      renderDuplicate();
      checkBarcode();
      clearTimeout(lookupTimer);
      lookupTimer = setTimeout(() => void lookupBarcode(), 250);
    });
    name.addEventListener("input", checkName);
    price.addEventListener("input", checkPrice);
    for (const input of [barcode, name, price]) {
      input.addEventListener("blur", () => {
        if (input.value.trim()) touched.add(input);
        checkAll();
      });
    }

    async function generateBarcode() {
      formError.textContent = "";
      try {
        barcode.value = (await api.nextBarcode()).barcode;
        duplicate = null;
        renderDuplicate();
        touched.add(barcode);
        checkBarcode();
        name.focus();
      } catch (e) {
        formError.textContent = errorMessage(e);
      }
    }

    // The scanner types the code and presses Enter: check it and move on instead of submitting.
    const enterMovesTo = (from: HTMLInputElement, to: HTMLInputElement, before?: () => unknown) =>
      from.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        void before?.();
        to.focus();
        to.select();
      });
    enterMovesTo(barcode, name, () => {
      clearTimeout(lookupTimer);
      touched.add(barcode);
      return lookupBarcode();
    });
    enterMovesTo(name, price);

    const form = h(
      "form",
      {
        class: "form",
        novalidate: true,
        onsubmit: async (e: Event) => {
          e.preventDefault();
          formError.textContent = "";
          for (const input of [barcode, name, price]) touched.add(input);
          clearTimeout(lookupTimer);
          await lookupBarcode();
          const errors = checkAll();
          const firstBad = errors.findIndex(Boolean);
          if (firstBad >= 0) {
            [barcode, name, price][firstBad]!.focus();
            return;
          }
          const input = { barcode: barcode.value.trim(), name: name.value.trim(), price_kurus: parseMoney(price.value)! };
          saveButton.disabled = true;
          try {
            close({ saved: product ? await api.updateProduct(product.id, input) : await api.createProduct(input) });
          } catch (err) {
            formError.textContent = errorMessage(err);
          } finally {
            saveButton.disabled = false;
          }
        },
      },
      h("h2", {}, product ? "Ürünü Düzenle" : "Yeni Ürün"),
      barcodeField.wrap,
      nameField.wrap,
      priceField.wrap,
      formError,
      h("div", { class: "dialog-actions" }, h("button", { type: "button", class: "btn", onclick: () => close(null) }, "Vazgeç"), saveButton),
    );

    // A barcode filled in from a scan (Satış → Ürün Ekle) is checked at once.
    if (barcode.value) {
      touched.add(barcode);
      void lookupBarcode();
    }
    // Focus the first empty field once the dialog is open.
    setTimeout(() => (barcode.value ? (name.value ? price : name) : barcode).focus(), 0);
    return [form];
  });
}
