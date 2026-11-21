// Kategoriler (under Yönetim): add, rename and delete categories, and turn the two-price
// (empty / with helium) pricing on or off for each one.

import type { Category } from "../../shared/types";
import { categoryNameError, MAX_CATEGORY_LENGTH } from "../../shared/validate";
import { api } from "../api";
import { loadCategories } from "../state";
import { confirmDialog, errorMessage, h, openDialog, run, toast, type Screen } from "../ui";

function openCategoryForm(category?: Category): Promise<Category | null> {
  return openDialog<Category>((close) => {
    const name = h("input", { class: "input", maxLength: MAX_CATEGORY_LENGTH, autocomplete: "off", value: category?.name ?? "" });
    const helium = h("input", { type: "checkbox", checked: category?.helium_pricing === 1 });
    const nameError = h("div", { class: "field-error", role: "alert" });
    const formError = h("div", { class: "form-error", role: "alert" });
    const saveButton = h("button", { type: "submit", class: "btn btn-primary" }, "Kaydet");

    async function save(e: Event) {
      e.preventDefault();
      formError.textContent = "";
      const error = categoryNameError(name.value.trim());
      nameError.textContent = error ?? "";
      name.classList.toggle("invalid", !!error);
      if (error) return name.focus();
      const input = { name: name.value.trim(), helium_pricing: helium.checked };
      // Turning helium pricing off clears the helium price of the products in the category.
      if (category?.helium_pricing && !helium.checked && category.product_count > 0) {
        const ok = await confirmDialog(
          `"${category.name}" kategorisindeki ${category.product_count} ürünün helyumlu fiyatı silinecek. Devam edilsin mi?`,
          "Evet, devam et",
        );
        if (!ok) return;
      }
      saveButton.disabled = true;
      try {
        close(category ? await api.updateCategory(category.id, input) : await api.createCategory(input));
      } catch (err) {
        formError.textContent = errorMessage(err);
      } finally {
        saveButton.disabled = false;
      }
    }

    setTimeout(() => name.focus(), 0);
    return [
      h(
        "form",
        { class: "form", novalidate: true, onsubmit: save },
        h("h2", {}, category ? "Kategoriyi Düzenle" : "Yeni Kategori"),
        h("label", { class: "field" }, h("span", {}, "Kategori adı"), name, nameError),
        h("label", { class: "check" }, helium, " Boş ve helyumlu olarak iki satış fiyatı var (balon gibi)"),
        h("div", { class: "muted small" }, "Bu seçenek açıksa ürün formunda ikinci fiyat sorulur. Satışta ürünün yanında \"Helyumlu\" kutusu çıkar."),
        formError,
        h("div", { class: "dialog-actions" }, h("button", { type: "button", class: "btn", onclick: () => close(null) }, "Vazgeç"), saveButton),
      ),
    ];
  });
}

export function createCategoriesScreen(): Screen {
  const tbody = h("tbody");

  async function load() {
    render(await loadCategories());
  }

  async function add() {
    const created = await openCategoryForm();
    if (!created) return;
    toast(`"${created.name}" kategorisi eklendi.`, "success");
    await load();
  }

  async function edit(category: Category) {
    if (!(await openCategoryForm(category))) return;
    toast("Kategori kaydedildi.", "success");
    await load();
  }

  async function remove(category: Category) {
    if (!(await confirmDialog(`"${category.name}" kategorisi silinsin mi?`, "Evet, sil"))) return;
    await api.deleteCategory(category.id);
    toast("Kategori silindi.", "success");
    await load();
  }

  function render(categories: Category[]) {
    tbody.replaceChildren(
      ...categories.map((c) =>
        h(
          "tr",
          {},
          h("td", { class: "strong" }, c.name),
          h("td", {}, c.helium_pricing ? "Boş / helyumlu (iki fiyat)" : h("span", { class: "muted" }, "Tek fiyat")),
          h("td", { class: "num" }, c.product_count),
          h(
            "td",
            { class: "actions" },
            h("button", { class: "btn", onclick: () => run(() => edit(c)) }, "Düzenle"),
            h(
              "button",
              { class: "btn btn-danger-outline", disabled: c.product_count > 0, title: c.product_count > 0 ? "Kategoride ürün var" : "", onclick: () => run(() => remove(c)) },
              "Sil",
            ),
          ),
        ),
      ),
    );
    if (categories.length === 0) tbody.append(h("tr", {}, h("td", { colSpan: 4, class: "empty" }, "Henüz kategori yok. \"Yeni Kategori\" ile ekleyin.")));
  }

  const el = h(
    "section",
    { class: "screen screen-categories" },
    h("div", { class: "toolbar" }, h("button", { class: "btn btn-primary", onclick: () => run(add) }, "Yeni Kategori")),
    h(
      "div",
      { class: "table-wrap" },
      h(
        "table",
        { class: "table" },
        h("thead", {}, h("tr", {}, h("th", {}, "Kategori"), h("th", {}, "Fiyat"), h("th", { class: "num" }, "Ürün sayısı"), h("th", {}, ""))),
        tbody,
      ),
    ),
    h("p", { class: "muted small" }, "Ürünün kategorisi Ürünler ekranında, ürünü düzenlerken seçilir. İçinde ürün olan kategori silinemez."),
  );

  return { id: "kategoriler", el, show: () => run(load) };
}
