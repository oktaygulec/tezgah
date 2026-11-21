// Cart / order arithmetic. All amounts are integer kuruş.

export interface CartLine {
  product_id: number;
  barcode: string;
  name: string;
  unit_price_kurus: number;
  quantity: number;
}

export function lineTotal(line: { unit_price_kurus: number; quantity: number }): number {
  return line.unit_price_kurus * line.quantity;
}

export function orderTotal(lines: { unit_price_kurus: number; quantity: number }[]): number {
  return lines.reduce((sum, line) => sum + lineTotal(line), 0);
}

/** Adds one unit of a product: increases the quantity of an existing line or appends a new line. */
export function addToCart(
  lines: CartLine[],
  product: { id: number; barcode: string; name: string; price_kurus: number },
): CartLine[] {
  const existing = lines.find((l) => l.product_id === product.id);
  if (existing) {
    return lines.map((l) => (l === existing ? { ...l, quantity: l.quantity + 1 } : l));
  }
  return [
    ...lines,
    {
      product_id: product.id,
      barcode: product.barcode,
      name: product.name,
      unit_price_kurus: product.price_kurus,
      quantity: 1,
    },
  ];
}
