// The category drop-down of the product lists: all, one category, or products without a category.

import type { Product } from "../shared/types";
import { getCategories } from "./state";
import { h } from "./ui";

const ALL = "all";
const NONE = "none";

export interface CategoryFilter {
  el: HTMLSelectElement;
  /** Fills the options again from the loaded categories; keeps the choice when it still exists. */
  fill(): void;
  matches(p: Pick<Product, "category_id">): boolean;
}

export function categoryFilter(onChange: () => void): CategoryFilter {
  const el = h("select", { class: "input input-auto", "aria-label": "Kategori" });
  el.addEventListener("change", onChange);
  return {
    el,
    fill() {
      const current = el.value || ALL;
      el.replaceChildren(
        h("option", { value: ALL }, "Tüm kategoriler"),
        ...getCategories().map((c) => h("option", { value: String(c.id) }, c.name)),
        h("option", { value: NONE }, "Kategorisi olmayanlar"),
      );
      el.value = [...el.options].some((o) => o.value === current) ? current : ALL;
    },
    matches(p) {
      const v = el.value;
      return v === ALL || !v ? true : v === NONE ? p.category_id === null : p.category_id === Number(v);
    },
  };
}
