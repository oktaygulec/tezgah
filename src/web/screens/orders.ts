// Siparişler: orders of a day, newest first; click an order to see its lines or cancel it.

import { formatMoney } from "../../shared/money";
import { formatDateTime, istanbulDay } from "../../shared/time";
import type { Order, OrderWithLines } from "../../shared/types";
import { api } from "../api";
import { confirmDialog, h, run, toast, type Screen } from "../ui";

export function createOrdersScreen(): Screen {
  const dayInput = h("input", { class: "input", type: "date", value: istanbulDay() });
  dayInput.addEventListener("change", () => run(load));
  const tbody = h("tbody");
  const summary = h("div", { class: "strong" });
  const emptyDetail = h("div", { class: "muted" }, "Satırlarını görmek için bir sipariş seçin.");
  const detail = h("div", { class: "order-detail" }, emptyDetail);
  let openId: number | null = null;

  async function load() {
    renderList(await api.orders(dayInput.value || undefined));
  }

  function renderList(orders: Order[]) {
    tbody.replaceChildren(
      ...orders.map((o) =>
        h(
          "tr",
          { class: `clickable${o.cancelled_at ? " cancelled" : ""}${o.id === openId ? " selected" : ""}`, onclick: () => run(() => openOrder(o.id)) },
          h("td", { class: "strong" }, `No ${o.order_no}`, o.cancelled_at && h("span", { class: "badge-cancelled" }, "İPTAL")),
          h("td", {}, formatDateTime(o.created_at)),
          h("td", { class: "num" }, o.line_count),
          h("td", { class: "num strong order-amount" }, formatMoney(o.total_kurus)),
        ),
      ),
    );
    if (orders.length === 0) tbody.append(h("tr", {}, h("td", { colSpan: 4, class: "empty" }, "Bu gün için sipariş yok.")));
    const active = orders.filter((o) => !o.cancelled_at);
    const cancelled = orders.length - active.length;
    const sum = active.reduce((s, o) => s + o.total_kurus, 0);
    summary.textContent =
      `${active.length} sipariş, toplam ${formatMoney(sum)}` + (cancelled ? ` (${cancelled} iptal edilen sipariş toplama dahil değil)` : "");
  }

  async function cancel(order: OrderWithLines) {
    const ok = await confirmDialog(
      `Sipariş No ${order.order_no} (${formatMoney(order.total_kurus)}) iptal edilsin mi? Bu işlem geri alınamaz.`,
      "Evet, iptal et",
    );
    if (!ok) return;
    const updated = await api.cancelOrder(order.id);
    toast(`Sipariş No ${updated.order_no} iptal edildi.`, "success");
    await load();
    renderDetail(updated);
  }

  async function remove(order: OrderWithLines) {
    const ok = await confirmDialog(
      `İptal edilmiş Sipariş No ${order.order_no} kalıcı olarak silinsin mi? Bu işlem geri alınamaz.`,
      "Evet, kalıcı olarak sil",
    );
    if (!ok) return;
    await api.deleteOrder(order.id);
    toast(`Sipariş No ${order.order_no} silindi.`, "success");
    openId = null;
    detail.replaceChildren(emptyDetail);
    await load();
  }

  async function openOrder(id: number) {
    openId = id;
    renderDetail(await api.order(id));
    await load();
  }

  function renderDetail(order: OrderWithLines) {
    const lines = h(
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
    );
    // h() skips false values, so the optional parts can stay inline.
    const body = h(
      "div",
      {},
      h("h2", {}, `Sipariş No ${order.order_no}`),
      h("div", { class: "muted" }, formatDateTime(order.created_at)),
      order.cancelled_at && h("div", { class: "notice notice-error" }, `İptal edildi: ${formatDateTime(order.cancelled_at)}`),
      lines,
      h("div", { class: `order-total${order.cancelled_at ? " struck" : ""}` }, "Toplam: ", h("strong", {}, formatMoney(order.total_kurus))),
      h(
        "div",
        { class: "order-actions" },
        order.cancelled_at
          ? h("button", { class: "btn btn-danger-outline", onclick: () => run(() => remove(order)) }, "Siparişi Sil")
          : h("button", { class: "btn btn-danger", onclick: () => run(() => cancel(order)) }, "Siparişi İptal Et"),
      ),
    );
    detail.replaceChildren(body);
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
