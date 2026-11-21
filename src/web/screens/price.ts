// Fiyat Gör: scan a code and show the name and price in very large text.

import { formatMoney } from "../../shared/money";
import { findProduct } from "../api";
import { errorSound, h, scanField, type Screen } from "../ui";

export function createPriceScreen(): Screen {
  const result = h("div", { class: "price-result" }, h("div", { class: "price-hint" }, "Fiyatını görmek için ürünü okutun."));

  const scanInput = scanField("Barkodu okutun…", async (code) => {
    const product = await findProduct(code);
    if (!product) {
      errorSound();
      result.replaceChildren(h("div", { class: "price-missing" }, `Ürün bulunamadı: ${code}`));
      return;
    }
    result.replaceChildren(
      h("div", { class: "price-name" }, product.name),
      h("div", { class: "price-big" }, formatMoney(product.price_kurus)),
      h("div", { class: "muted" }, product.barcode),
    );
  });

  const el = h("section", { class: "screen screen-price" }, h("div", { class: "scanbar" }, scanInput), result);
  return { id: "fiyat", el, scanInput, show: () => {} };
}
