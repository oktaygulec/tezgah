// Stok Girişi: scan the goods that came in, check the quantities, then add them all to stock at once.

import { MAX_STOCK_NOTE_LENGTH, MAX_STOCK_QUANTITY, parseQuantity, stockQuantityError } from "../../shared/stock";
import type { Product } from "../../shared/types";
import { api, findProduct } from "../api";
import { openProductForm } from "../productForm";
import { confirmDialog, errorSound, h, run, scanField, toast, type Screen } from "../ui";

const LIST_KEY = "tezgah.stockin";

interface InLine {
  product_id: number;
  barcode: string;
  name: string;
  stock_qty: number; // stock when scanned, for information
  quantity: number;
}

function loadList(): InLine[] {
  const raw = localStorage.getItem(LIST_KEY);
  if (!raw) return [];
  try {
    const lines = JSON.parse(raw);
    if (!Array.isArray(lines)) throw new Error("liste değil");
    return lines as InLine[];
  } catch (e) {
    toast(`Kayıtlı stok girişi okunamadı, boş liste başlatıldı: ${(e as Error).message}`, "error");
    return [];
  }
}

export function createStockInScreen(): Screen {
  let lines = loadList();

  const notice = h("div", { class: "notice", hidden: true });
  const tbody = h("tbody");
  const summary = h("div", { class: "stockin-summary" });
  const note = h("input", { class: "input", maxLength: MAX_STOCK_NOTE_LENGTH, placeholder: "Not (isteğe bağlı): tedarikçi, fatura no" });
  const saveButton = h("button", { class: "btn btn-primary btn-xl", onclick: () => run(save) }, "Stoğa Ekle");
  const clearButton = h("button", { class: "btn btn-danger btn-xl", onclick: () => run(clear) }, "Listeyi Temizle");

  const scanInput = scanField("Gelen ürünün barkodunu okutun…", async (code) => {
    const product = await findProduct(code);
    if (product) {
      notice.hidden = true;
      add(product);
    } else {
      unknownBarcode(code);
    }
  });

  function setLines(next: InLine[]) {
    lines = next;
    localStorage.setItem(LIST_KEY, JSON.stringify(lines));
    render();
  }

  function add(product: Product) {
    const existing = lines.find((l) => l.product_id === product.id);
    if (existing) {
      setLines(lines.map((l) => (l === existing ? { ...l, quantity: Math.min(MAX_STOCK_QUANTITY, l.quantity + 1) } : l)));
    } else {
      setLines([...lines, { product_id: product.id, barcode: product.barcode, name: product.name, stock_qty: product.stock_qty, quantity: 1 }]);
    }
  }

  /** Changes a quantity by delta; at 0 the line is removed. */
  function changeQuantity(line: InLine, delta: number) {
    const quantity = Math.min(MAX_STOCK_QUANTITY, line.quantity + delta);
    setLines(quantity < 1 ? lines.filter((l) => l !== line) : lines.map((l) => (l === line ? { ...l, quantity } : l)));
  }

  function showNotice(kind: "error" | "success", ...content: (Node | string)[]) {
    notice.className = `notice notice-${kind}`;
    notice.replaceChildren(...content);
    notice.hidden = false;
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
                notice.hidden = true;
                add(product);
              }
            }),
        },
        "Ürün Ekle",
      ),
    );
  }

  async function save() {
    if (lines.length === 0) {
      toast("Liste boş. Önce gelen ürünleri okutun.", "error");
      return;
    }
    const bad = lines.find((l) => stockQuantityError("add", l.quantity));
    if (bad) throw new Error(`${bad.name}: ${stockQuantityError("add", bad.quantity)}`);
    saveButton.disabled = true;
    try {
      const result = await api.receiveStock(
        lines.map((l) => ({ product_id: l.product_id, quantity: l.quantity })),
        note.value.trim(),
      );
      setLines([]);
      note.value = "";
      showNotice("success", `${result.products} ürün, toplam ${result.pieces} adet stoğa eklendi.`);
    } finally {
      saveButton.disabled = false;
    }
  }

  async function clear() {
    if (lines.length === 0) return;
    if (await confirmDialog("Liste temizlensin mi? Okutulan ürünler stoğa eklenmez.", "Evet, temizle")) {
      setLines([]);
      notice.hidden = true;
    }
  }

  function quantityInput(line: InLine) {
    const input = h("input", { class: "input input-copies", inputMode: "numeric", value: line.quantity, title: "Gelen adet" });
    input.addEventListener("change", () => {
      const q = parseQuantity(input.value);
      const error = stockQuantityError("add", q);
      if (error) {
        toast(`${line.name}: ${error}`, "error");
        input.value = String(line.quantity);
        return;
      }
      setLines(lines.map((l) => (l.product_id === line.product_id ? { ...l, quantity: q } : l)));
    });
    return input;
  }

  function render() {
    tbody.replaceChildren(
      ...lines.map((line) =>
        h(
          "tr",
          {},
          h("td", { class: "col-name" }, line.name, h("div", { class: "muted small" }, line.barcode)),
          h("td", { class: `num${line.stock_qty <= 0 ? " stock-low" : ""}` }, line.stock_qty),
          h(
            "td",
            { class: "qty" },
            h("button", { class: "btn btn-qty", title: "Azalt", onclick: () => changeQuantity(line, -1) }, "−"),
            quantityInput(line),
            h("button", { class: "btn btn-qty", title: "Artır", onclick: () => changeQuantity(line, 1) }, "+"),
          ),
          h("td", { class: "num strong" }, line.stock_qty + line.quantity),
          h("td", {}, h("button", { class: "btn btn-danger-outline", onclick: () => setLines(lines.filter((l) => l !== line)) }, "Kaldır")),
        ),
      ),
    );
    if (lines.length === 0) {
      tbody.append(h("tr", {}, h("td", { colSpan: 5, class: "empty" }, "Gelen ürünleri okutun. Aynı ürünü tekrar okutmak adedi 1 artırır.")));
    }
    const pieces = lines.reduce((n, l) => n + l.quantity, 0);
    summary.replaceChildren(h("span", {}, "TOPLAM"), h("strong", {}, `${lines.length} ürün, ${pieces} adet`));
    saveButton.disabled = lines.length === 0;
  }

  render();

  const el = h(
    "section",
    { class: "screen screen-stockin" },
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
          h("tr", {}, h("th", {}, "Ürün"), h("th", { class: "num" }, "Şu anki stok"), h("th", {}, "Gelen adet"), h("th", { class: "num" }, "Yeni stok"), h("th", {}, "")),
        ),
        tbody,
      ),
    ),
    h("footer", { class: "sale-footer stockin-footer" }, clearButton, note, summary, saveButton),
  );

  return { id: "stok", el, scanInput, show: () => {} };
}
