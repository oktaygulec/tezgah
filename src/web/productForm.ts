// Add / edit product dialog, used by Ürünler and by Satış for unknown barcodes.
// A category with helium pricing (Balon) shows a second sale price. The photo is optional.
// Each field shows its own error. A barcode that another product already uses is reported
// while typing or scanning, and the user can open that product instead.

import { ean13Warning } from "../shared/barcode";
import { formatMoney, formatMoneyPlain, parseMoney } from "../shared/money";
import { productImageUrl, type Product } from "../shared/types";
import { parseQuantity, stockQuantityError } from "../shared/stock";
import { barcodeError, costTextError, heliumTextError, MAX_BARCODE_LENGTH, MAX_NAME_LENGTH, nameError, priceTextError } from "../shared/validate";
import { api, findProduct } from "./api";
import { shrinkImage } from "./image";
import { categoryOf, getCategories } from "./state";
import { errorMessage, h, openDialog, toast } from "./ui";

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
    // Starting stock: only for a new product. Later changes go through the Stok dialog (they need a history).
    const stock = h("input", { class: "input input-number", name: "stock", inputMode: "numeric", autocomplete: "off", placeholder: "0" });
    // Purchase price: optional; it never appears on labels or on the price check screen.
    const cost = h("input", {
      class: "input",
      name: "cost",
      inputMode: "decimal",
      autocomplete: "off",
      placeholder: "Bilinmiyorsa boş bırakın",
      value: product && product.cost_kurus !== null ? formatMoneyPlain(product.cost_kurus) : "",
    });
    const helium = h("input", {
      class: "input",
      name: "helium",
      inputMode: "decimal",
      autocomplete: "off",
      placeholder: "40,00",
      value: product && product.helium_price_kurus !== null ? formatMoneyPlain(product.helium_price_kurus) : "",
    });
    const category = h(
      "select",
      { class: "input", name: "category" },
      h("option", { value: "" }, "Kategori yok"),
      ...getCategories().map((c) => h("option", { value: String(c.id), selected: c.id === product?.category_id }, c.name + (c.helium_pricing ? " (boş / helyumlu fiyat)" : ""))),
    );
    const favorite = h("input", { type: "checkbox", checked: product?.favorite === 1 });
    const profitInfo = h("div", { class: "field-info" });
    const formError = h("div", { class: "form-error", role: "alert" });
    const saveButton = h("button", { type: "submit", class: "btn btn-primary" }, "Kaydet");

    const generate = h("button", { type: "button", class: "btn", onclick: () => void generateBarcode() }, "Barkod oluştur");
    const duplicateBox = h("div", { class: "duplicate", hidden: true });
    const barcodeField = field("Barkod", h("div", { class: "row" }, barcode, generate), duplicateBox);
    const nameField = field("Ürün adı", name);
    const priceField = field("Satış fiyatı (₺)", price);
    const heliumField = field("Helyumlu satış fiyatı (₺)", helium);
    const categoryField = field("Kategori", category);
    const priceLabel = priceField.wrap.querySelector("span")!;
    /** True when the chosen category has two prices (empty / with helium). */
    const heliumOn = () => !!categoryOf(category.value ? Number(category.value) : null)?.helium_pricing;
    function showHelium() {
      heliumField.wrap.hidden = !heliumOn();
      priceLabel.textContent = heliumOn() ? "Boş satış fiyatı (₺)" : "Satış fiyatı (₺)";
    }
    category.addEventListener("change", () => {
      showHelium();
      checkHelium();
      checkCost();
    });

    // Photo: chosen here, uploaded after the product is saved.
    let photo: Blob | null = null; // new photo to upload
    let removePhoto = false;
    let photoUrl: string | null = product ? productImageUrl(product) : null;
    const photoBox = h("div", { class: "photo-box" });
    const photoInput = h("input", { type: "file", accept: "image/*", hidden: true });
    const photoError = h("div", { class: "field-error", role: "alert" });
    photoInput.addEventListener("change", async () => {
      const file = photoInput.files?.[0];
      photoInput.value = "";
      if (!file) return;
      photoError.textContent = "";
      try {
        photo = await shrinkImage(file);
        removePhoto = false;
        if (photoUrl?.startsWith("blob:")) URL.revokeObjectURL(photoUrl);
        photoUrl = URL.createObjectURL(photo);
        renderPhoto();
      } catch (e) {
        photoError.textContent = errorMessage(e);
      }
    });
    function renderPhoto() {
      photoBox.replaceChildren(
        photoUrl ? h("img", { class: "photo-preview", src: photoUrl, alt: "Ürün fotoğrafı" }) : h("div", { class: "photo-preview photo-none" }, "Fotoğraf yok"),
        h(
          "div",
          { class: "row" },
          h("button", { type: "button", class: "btn", onclick: () => photoInput.click() }, photoUrl ? "Değiştir" : "Fotoğraf seç"),
          photoUrl &&
            h(
              "button",
              {
                type: "button",
                class: "btn btn-danger-outline",
                onclick: () => {
                  if (photoUrl?.startsWith("blob:")) URL.revokeObjectURL(photoUrl);
                  photo = null;
                  photoUrl = null;
                  removePhoto = !!product?.image_at;
                  renderPhoto();
                },
              },
              "Kaldır",
            ),
        ),
      );
    }
    renderPhoto();
    const costField = field("Alış fiyatı (₺, isteğe bağlı)", cost, profitInfo);
    const stockField = field("Başlangıç stoğu (adet, isteğe bağlı)", stock);

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
    const checkHelium = () => show(heliumField, helium, heliumOn() ? heliumTextError(helium.value) : null);
    function checkPrice() {
      const error = priceTextError(price.value);
      priceField.hint.textContent = !error && parseMoney(price.value) === 0 ? "Fiyat ₺0,00. Doğru mu?" : "";
      return show(priceField, price, error);
    }
    /** Empty means 0. */
    const stockValue = () => (stock.value.trim() === "" ? 0 : parseQuantity(stock.value));
    const checkStock = () =>
      show(stockField, stock, product ? null : Number.isNaN(stockValue()) ? "Stok 0 veya daha büyük bir tam sayı olmalı." : stockQuantityError("set", stockValue()));
    /** Purchase price check, plus the profit per piece when both prices are valid. */
    function checkCost() {
      const error = show(costField, cost, costTextError(cost.value));
      const sale = parseMoney(price.value);
      const buy = cost.value.trim() === "" ? null : parseMoney(cost.value);
      profitInfo.textContent = "";
      costField.hint.textContent = "";
      if (!error && sale !== null && buy !== null) {
        const profit = sale - buy;
        const pct = (p: number, of: number) => (of > 0 ? ` (%${((p / of) * 100).toFixed(1).replace(".", ",")})` : "");
        if (profit < 0) costField.hint.textContent = `Alış fiyatı satış fiyatından yüksek: her satışta ${formatMoney(-profit)} zarar.`;
        else profitInfo.textContent = `Adet başı kâr${heliumOn() ? " (boş)" : ""}: ${formatMoney(profit)}${pct(profit, sale)}`;
        const withHelium = heliumOn() && !heliumTextError(helium.value) ? parseMoney(helium.value) : null;
        if (withHelium !== null) profitInfo.textContent += ` · helyumlu: ${formatMoney(withHelium - buy)}${pct(withHelium - buy, withHelium)}`;
      }
      return error;
    }
    const inputs = [barcode, name, price, helium, cost, stock];
    const checkAll = () => [checkBarcode(), checkName(), checkPrice(), checkHelium(), checkCost(), checkStock()];

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
    price.addEventListener("input", () => {
      checkPrice();
      checkCost();
    });
    cost.addEventListener("input", checkCost);
    helium.addEventListener("input", () => {
      checkHelium();
      checkCost();
    });
    stock.addEventListener("input", checkStock);
    for (const input of inputs) {
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
        class: "form product-form",
        novalidate: true,
        onsubmit: async (e: Event) => {
          e.preventDefault();
          formError.textContent = "";
          for (const input of inputs) touched.add(input);
          clearTimeout(lookupTimer);
          await lookupBarcode();
          const errors = checkAll();
          const firstBad = errors.findIndex(Boolean);
          if (firstBad >= 0) {
            inputs[firstBad]!.focus();
            return;
          }
          const input = {
            barcode: barcode.value.trim(),
            name: name.value.trim(),
            price_kurus: parseMoney(price.value)!,
            cost_kurus: cost.value.trim() === "" ? null : parseMoney(cost.value)!,
            category_id: category.value ? Number(category.value) : null,
            helium_price_kurus: heliumOn() ? parseMoney(helium.value)! : null,
            favorite: favorite.checked,
          };
          saveButton.disabled = true;
          let saved: Product;
          try {
            saved = product ? await api.updateProduct(product.id, input) : await api.createProduct(input, stockValue());
          } catch (err) {
            formError.textContent = errorMessage(err);
            saveButton.disabled = false;
            return;
          }
          // The product is saved; a photo error does not undo that.
          try {
            if (photo) saved = await api.uploadImage(saved.id, photo);
            else if (removePhoto) saved = await api.deleteImage(saved.id);
          } catch (err) {
            toast(`Ürün kaydedildi, fotoğraf kaydedilemedi: ${errorMessage(err)}`, "error");
          }
          if (photoUrl?.startsWith("blob:")) URL.revokeObjectURL(photoUrl);
          close({ saved });
        },
      },
      h("h2", {}, product ? "Ürünü Düzenle" : "Yeni Ürün"),
      h(
        "div",
        { class: "product-form-grid" },
        h(
          "div",
          { class: "form-col" },
          barcodeField.wrap,
          nameField.wrap,
          categoryField.wrap,
          h("div", { class: "price-fields" }, priceField.wrap, heliumField.wrap),
          costField.wrap,
          !product && stockField.wrap,
        ),
        h(
          "div",
          { class: "form-col" },
          h("div", { class: "field" }, h("span", {}, "Fotoğraf (isteğe bağlı)"), photoBox, photoError, photoInput),
          h("label", { class: "check" }, favorite, " Favori"),
          h("div", { class: "muted small" }, "Favori ürünler Satış ekranındaki \"Ürün seç\" listesinde görünür."),
        ),
      ),
      formError,
      h("div", { class: "dialog-actions" }, h("button", { type: "button", class: "btn", onclick: () => close(null) }, "Vazgeç"), saveButton),
    );

    // A barcode filled in from a scan (Satış → Ürün Ekle) is checked at once.
    if (barcode.value) {
      touched.add(barcode);
      void lookupBarcode();
    }
    showHelium();
    if (product) checkCost(); // show the profit of a product with prices
    // Focus the first empty field once the dialog is open.
    setTimeout(() => (barcode.value ? (name.value ? price : name) : barcode).focus(), 0);
    return [form];
  });
}
