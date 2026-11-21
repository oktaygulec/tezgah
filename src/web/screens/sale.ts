// Satış: scan items (or pick a favorite with "Ürün seç") into an order, then complete or cancel it.
// Balloon lines have a "Helyumlu" box that switches the line to the helium price.

import { formatMoney } from "../../shared/money";
import { addToCart, lineTotal, orderTotal, setLineHelium, type CartLine } from "../../shared/order";
import { salePrice, type Product } from "../../shared/types";
import { api, ApiError, findProduct } from "../api";
import { thumbnail } from "../image";
import { openProductForm } from "../productForm";
import { matchesSearch, sortByName } from "../search";
import { getCategories } from "../state";
import { confirmDialog, errorSound, h, openDialog, run, scanField, toast, type Screen } from "../ui";

type Pick = { product: Product; helium: boolean };

/** "Ürün seç": a grid of the favorite products, grouped by category. Resolves with the chosen product. */
async function pickFavorite(): Promise<Pick | null> {
  const favorites = sortByName((await api.products()).filter((p) => p.favorite === 1));
  return openDialog<Pick>((close) => {
    const search = h("input", { class: "input", type: "search", placeholder: "Favorilerde ara…", autocomplete: "off" });
    const grid = h("div", { class: "fav-groups" });

    const tile = (p: Product) => {
      const choose = (helium: boolean) => close({ product: p, helium });
      const body = [thumbnail(p, "md"), h("div", { class: "fav-name" }, p.name)];
      if (p.helium_price_kurus === null) {
        return h("button", { type: "button", class: "fav-tile", onclick: () => choose(false) }, ...body, h("div", { class: "fav-price" }, formatMoney(p.price_kurus)));
      }
      return h(
        "div",
        { class: "fav-tile fav-tile-two" },
        ...body,
        h(
          "div",
          { class: "fav-choices" },
          h("button", { type: "button", class: "btn", onclick: () => choose(false) }, h("span", { class: "small" }, "Boş"), formatMoney(p.price_kurus)),
          h("button", { type: "button", class: "btn btn-primary", onclick: () => choose(true) }, h("span", { class: "small" }, "Helyumlu"), formatMoney(p.helium_price_kurus)),
        ),
      );
    };

    function render() {
      const shown = favorites.filter((p) => matchesSearch(p, search.value));
      const groups = [
        ...getCategories().map((c) => ({ name: c.name, items: shown.filter((p) => p.category_id === c.id) })),
        { name: "Kategorisi olmayanlar", items: shown.filter((p) => !getCategories().some((c) => c.id === p.category_id)) },
      ].filter((g) => g.items.length > 0);
      grid.replaceChildren(
        ...groups.map((g) => h("section", {}, groups.length > 1 && h("h3", {}, g.name), h("div", { class: "fav-grid" }, ...g.items.map(tile)))),
      );
      if (shown.length === 0) {
        grid.append(
          h(
            "div",
            { class: "empty" },
            favorites.length ? "Aramaya uyan favori ürün yok." : "Favori ürün yok. Yönetim → Ürünler ekranında ürünün yanındaki ☆ işaretine tıklayın.",
          ),
        );
      }
    }
    search.addEventListener("input", render);
    // Enter picks the only match (also works when a barcode is scanned into the search box).
    search.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const shown = favorites.filter((p) => matchesSearch(p, search.value));
      if (shown.length === 1) close({ product: shown[0]!, helium: false });
    });
    render();
    setTimeout(() => search.focus(), 0);
    return [
      h("div", { class: "dialog-head" }, h("h2", {}, "Ürün seç")),
      search,
      grid,
    ];
  });
}

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

  function add(product: Product, helium = false) {
    setCart(addToCart(cart, product, helium));
  }

  async function pick() {
    const chosen = await pickFavorite();
    if (!chosen) return;
    hideNotice();
    add(chosen.product, chosen.helium);
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
        cart.map((l) => ({ product_id: l.product_id, quantity: l.quantity, unit_price_kurus: l.unit_price_kurus, helium: !!l.helium })),
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
        if (!p) return l;
        const helium = !!l.helium && p.helium_price_kurus !== null;
        return {
          ...l,
          name: p.name,
          barcode: p.barcode,
          helium,
          helium_price_kurus: p.helium_price_kurus,
          base_price_kurus: p.price_kurus,
          unit_price_kurus: salePrice(p, helium),
          image_at: p.image_at,
        };
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

  function heliumBox(line: CartLine) {
    const box = h("input", { type: "checkbox", checked: !!line.helium });
    box.addEventListener("change", () => setCart(setLineHelium(cart, line, box.checked)));
    return h("label", { class: `helium-box${line.helium ? " on" : ""}`, title: "Helyumlu fiyatla sat" }, box, " Helyumlu");
  }

  function render() {
    tbody.replaceChildren(
      ...cart.map((line) =>
        h(
          "tr",
          {},
          h("td", { class: "col-thumb" }, thumbnail({ id: line.product_id, name: line.name, image_at: line.image_at ?? null })),
          h(
            "td",
            { class: "col-name" },
            h(
              "div",
              { class: "line-name" },
              line.name,
              line.helium_price_kurus !== null && line.helium_price_kurus !== undefined && heliumBox(line),
            ),
            h("div", { class: "muted small" }, line.barcode),
          ),
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
      tbody.append(h("tr", {}, h("td", { colSpan: 6, class: "empty" }, "Ürün okutun veya \"Ürün seç\" ile seçin. Ürünler burada listelenir.")));
    }
    total.replaceChildren(h("span", {}, "TOPLAM"), h("strong", {}, formatMoney(orderTotal(cart))));
  }

  render();

  const el = h(
    "section",
    { class: "screen screen-sale" },
    h("div", { class: "scanbar scanbar-row" }, scanInput, h("button", { class: "btn btn-xl btn-pick", onclick: () => run(pick) }, "Ürün seç")),
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
          h("tr", {}, h("th", {}, ""), h("th", {}, "Ürün"), h("th", { class: "num" }, "Birim fiyat"), h("th", {}, "Adet"), h("th", { class: "num" }, "Tutar"), h("th", {}, "")),
        ),
        tbody,
      ),
    ),
    h("footer", { class: "sale-footer" }, cancelButton, total, completeButton),
  );

  return { id: "satis", el, scanInput, show: () => {} };
}
