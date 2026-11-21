// Turkish-aware product search and sorting.

import type { Product } from "../shared/types";

/** True when the barcode or the name contains the query (Turkish lower case: "I" → "ı", "İ" → "i"). */
export function matchesSearch(product: Product, query: string): boolean {
  const q = query.trim().toLocaleLowerCase("tr-TR");
  if (!q) return true;
  return product.barcode.toLocaleLowerCase("tr-TR").includes(q) || product.name.toLocaleLowerCase("tr-TR").includes(q);
}

export function sortByName(products: Product[]): Product[] {
  return [...products].sort((a, b) => a.name.localeCompare(b.name, "tr-TR"));
}
