// Satış: scan items into an order, then complete or cancel it.

import { formatMoney } from "../../shared/money";
import { addToCart, lineTotal, orderTotal, type CartLine } from "../../shared/order";
import type { Product } from "../../shared/types";
import { api, ApiError, findProduct } from "../api";
import { openProductForm } from "../productForm";
import { confirmDialog, errorSound, h, run, scanField, toast, type Screen } from "../ui";

const CART_KEY = "tezgah.cart";

function loadCart(): CartLine[] {
  const raw = localStorage.getItem(CART_KEY);
  if (!raw) return [];
  try {
    const lines = JSON.parse(raw);
    if (!Array.isArray(lines)) throw new Error("liste değil");
    return lines as CartLine[];
  } catch (e) {
    toast(`Kayıtlı sipariş okunamadı, boş sipariş başlatıldı: ${(e as Error).message}`, "error");
    return [];
  }
}

export function createSaleScreen(): Screen {
  let cart = loadCart();

  const notice = h("div", { class: "notice", hidden: true });
  const tbody = h("tbody");
  const total = h("div", { class: "sale-total" });
  const completeButton = h("button", { class: "btn btn-primary btn-xl", onclick: () => run(complete) }, "Siparişi Tamamla");
  const cancelButton = h("button", { class: "btn btn-danger btn-xl", onclick: () => run(cancel) }, "Siparişi İptal Et");

  const scanInput = scanField("Barkodu okutun…", async (code) => {
    const product = await findProduct(code);
    if (product) {
      hideNotice();
      add(product);
    } else {
      unknownBarcode(code);
    }
  });

  function setCart(lines: CartLine[]) {
    cart = lines;
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
    render();
  }

  function add(product: Product) {
    setCart(addToCart(cart, product));
  }

  function changeQuantity(line: CartLine, delta: number) {
    const quantity = line.quantity + delta;
    setCart(quantity < 1 ? cart.filter((l) => l !== line) : cart.map((l) => (l === line ? { ...l, quantity } : l)));
  }

  function showNotice(kind: "error" | "success", ...content: (Node | string)[]) {
    notice.className = `notice notice-${kind}`;
    notice.replaceChildren(...content);
    notice.hidden = false;
  }

  function hideNotice() {
    notice.hidden = true;
  }

  function unknownBarcode(code: string) {
    errorSound();
    showNotice(
      "error",
      h("span", {}, `Ürün bulunamadı: ${code}`),
      h(
        "button",
        {
          class: "btn btn-primary",
          onclick: () =>
            run(async () => {
              const product = await openProductForm({ barcode: code });
              if (product) {
                hideNotice();
                add(product);
              }
            }),
        },
        "Ürün Ekle",
      ),
    );
  }

  async function complete() {
    if (cart.length === 0) {
      toast("Sipariş boş. Önce ürün okutun.", "error");
      return;
    }
    completeButton.disabled = true;
    try {
      const order = await api.createOrder(
        cart.map((l) => ({ product_id: l.product_id, quantity: l.quantity, unit_price_kurus: l.unit_price_kurus })),
      );
      setCart([]);
      showNotice("success", `Sipariş No ${order.order_no} kaydedildi. Toplam: ${formatMoney(order.total_kurus)}`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) await refreshPrices();
      throw e;
    } finally {
      completeButton.disabled = false;
    }
  }

  /** Updates names and prices in the cart from the database (after a price change). */
  async function refreshPrices() {
    const products = new Map((await api.products()).map((p) => [p.id, p]));
    setCart(
      cart.map((l) => {
        const p = products.get(l.product_id);
        return p ? { ...l, name: p.name, barcode: p.barcode, unit_price_kurus: p.price_kurus } : l;
      }),
    );
  }

  async function cancel() {
    if (cart.length === 0) return;
    if (await confirmDialog("Bu sipariş iptal edilsin mi? Okutulan tüm ürünler silinecek.", "Evet, iptal et")) {
      setCart([]);
      hideNotice();
    }
  }

  function render() {
    tbody.replaceChildren(
      ...cart.map((line) =>
        h(
          "tr",
          {},
          h("td", { class: "col-name" }, line.name, h("div", { class: "muted small" }, line.barcode)),
          h("td", { class: "num" }, formatMoney(line.unit_price_kurus)),
          h(
            "td",
            { class: "qty" },
            h("button", { class: "btn btn-qty", title: "Azalt", onclick: () => changeQuantity(line, -1) }, "−"),
            h("span", { class: "qty-value" }, line.quantity),
            h("button", { class: "btn btn-qty", title: "Artır", onclick: () => changeQuantity(line, 1) }, "+"),
          ),
          h("td", { class: "num strong" }, formatMoney(lineTotal(line))),
          h(
            "td",
            {},
            h("button", { class: "btn btn-danger-outline", onclick: () => setCart(cart.filter((l) => l !== line)) }, "Kaldır"),
          ),
        ),
      ),
    );
    if (cart.length === 0) {
      tbody.append(h("tr", {}, h("td", { colSpan: 5, class: "empty" }, "Ürün okutun. Okutulan ürünler burada listelenir.")));
    }
    total.replaceChildren(h("span", {}, "TOPLAM"), h("strong", {}, formatMoney(orderTotal(cart))));
  }

  render();

  const el = h(
    "section",
    { class: "screen screen-sale" },
    h("div", { class: "scanbar" }, scanInput),
    notice,
    h(
      "div",
      { class: "table-wrap" },
      h(
        "table",
        { class: "table sale-table" },
        h(
          "thead",
          {},
          h("tr", {}, h("th", {}, "Ürün"), h("th", { class: "num" }, "Birim fiyat"), h("th", {}, "Adet"), h("th", { class: "num" }, "Tutar"), h("th", {}, "")),
        ),
        tbody,
      ),
    ),
    h("footer", { class: "sale-footer" }, cancelButton, total, completeButton),
  );

  return { id: "satis", el, scanInput, show: () => {} };
}
