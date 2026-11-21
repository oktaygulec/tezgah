// Ürün Sorgula: scan a code and show the photo, name, price(s) and stock in very large text.

import { formatMoney } from "../../shared/money";
import { productImageUrl } from "../../shared/types";
import { findProduct } from "../api";
import { categoryOf } from "../state";
import { errorSound, h, scanField, type Screen } from "../ui";

export function createPriceScreen(): Screen {
  const result = h("div", { class: "price-result" }, h("div", { class: "price-hint" }, "Bilgilerini görmek için ürünü okutun."));

  const scanInput = scanField("Barkodu okutun…", async (code) => {
    const product = await findProduct(code);
    if (!product) {
      errorSound();
      result.replaceChildren(h("div", { class: "price-missing" }, `Ürün bulunamadı: ${code}`));
      return;
    }
    const image = productImageUrl(product);
    const category = categoryOf(product.category_id);
    const prices =
      product.helium_price_kurus === null
        ? h("div", { class: "price-big" }, formatMoney(product.price_kurus))
        : h(
            "div",
            { class: "price-pair" },
            h("div", {}, h("div", { class: "price-caption" }, "Boş"), h("div", { class: "price-big price-medium" }, formatMoney(product.price_kurus))),
            h("div", {}, h("div", { class: "price-caption" }, "Helyumlu"), h("div", { class: "price-big price-medium" }, formatMoney(product.helium_price_kurus))),
          );
    result.replaceChildren(
      h(
        "div",
        { class: "price-card" },
        image && h("img", { class: "price-image", src: image, alt: product.name }),
        h(
          "div",
          { class: "price-info" },
          h("div", { class: "price-name" }, product.name),
          category && h("div", { class: "muted price-category" }, category.name),
          prices,
          h("div", { class: `price-stock${product.stock_qty <= 0 ? " stock-low" : ""}` }, `Stok: ${product.stock_qty} adet`),
          h("div", { class: "muted" }, product.barcode),
        ),
      ),
    );
  });

  const el = h("section", { class: "screen screen-price" }, h("div", { class: "scanbar" }, scanInput), result);
  return { id: "sorgula", el, scanInput, show: () => {} };
}
