// Siparişler: orders of a day, newest first; click an order to see its lines.

import { formatMoney } from "../../shared/money";
import { formatDateTime, istanbulDay } from "../../shared/time";
import type { Order, OrderWithLines } from "../../shared/types";
import { api } from "../api";
import { h, run, type Screen } from "../ui";

export function createOrdersScreen(): Screen {
  const dayInput = h("input", { class: "input", type: "date", value: istanbulDay() });
  dayInput.addEventListener("change", () => run(load));
  const tbody = h("tbody");
  const summary = h("div", { class: "strong" });
  const detail = h("div", { class: "order-detail" }, h("div", { class: "muted" }, "Satırlarını görmek için bir sipariş seçin."));

  async function load() {
    const orders = await api.orders(dayInput.value || undefined);
    renderList(orders);
  }

  function renderList(orders: Order[]) {
    tbody.replaceChildren(
      ...orders.map((o) =>
        h(
          "tr",
          { class: "clickable", onclick: () => run(() => openOrder(o.id)) },
          h("td", { class: "strong" }, `No ${o.order_no}`),
          h("td", {}, formatDateTime(o.created_at)),
          h("td", { class: "num" }, o.line_count),
          h("td", { class: "num strong" }, formatMoney(o.total_kurus)),
        ),
      ),
    );
    if (orders.length === 0) tbody.append(h("tr", {}, h("td", { colSpan: 4, class: "empty" }, "Bu gün için sipariş yok.")));
    const sum = orders.reduce((s, o) => s + o.total_kurus, 0);
    summary.textContent = `${orders.length} sipariş, toplam ${formatMoney(sum)}`;
  }

  async function openOrder(id: number) {
    const order: OrderWithLines = await api.order(id);
    detail.replaceChildren(
      h("h2", {}, `Sipariş No ${order.order_no}`),
      h("div", { class: "muted" }, formatDateTime(order.created_at)),
      h(
        "table",
        { class: "table" },
        h("thead", {}, h("tr", {}, h("th", {}, "Ürün"), h("th", { class: "num" }, "Birim"), h("th", { class: "num" }, "Adet"), h("th", { class: "num" }, "Tutar"))),
        h(
          "tbody",
          {},
          ...order.lines.map((l) =>
            h(
              "tr",
              {},
              h("td", {}, l.name, h("div", { class: "muted small" }, l.barcode)),
              h("td", { class: "num" }, formatMoney(l.unit_price_kurus)),
              h("td", { class: "num" }, l.quantity),
              h("td", { class: "num" }, formatMoney(l.line_total_kurus)),
            ),
          ),
        ),
      ),
      h("div", { class: "order-total" }, "Toplam: ", h("strong", {}, formatMoney(order.total_kurus))),
    );
  }

  const el = h(
    "section",
    { class: "screen screen-orders" },
    h(
      "div",
      { class: "orders-left" },
      h(
        "div",
        { class: "toolbar" },
        h("label", { class: "row" }, "Gün: ", dayInput),
        h("button", { class: "btn", onclick: () => { dayInput.value = istanbulDay(); void run(load); } }, "Bugün"),
        h("button", { class: "btn", onclick: () => { dayInput.value = ""; void run(load); } }, "Son 200 sipariş"),
      ),
      summary,
      h(
        "div",
        { class: "table-wrap" },
        h(
          "table",
          { class: "table" },
          h("thead", {}, h("tr", {}, h("th", {}, "Sipariş"), h("th", {}, "Tarih"), h("th", { class: "num" }, "Satır"), h("th", { class: "num" }, "Toplam"))),
          tbody,
        ),
      ),
    ),
    detail,
  );

  return { id: "siparisler", el, show: () => run(load) };
}
