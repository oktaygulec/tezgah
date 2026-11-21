// Cart / order arithmetic. All amounts are integer kuruş.

export interface CartLine {
  product_id: number;
  barcode: string;
  name: string;
  unit_price_kurus: number;
  quantity: number;
  /** Sold with helium (balloons): the unit price is the helium price. */
  helium?: boolean;
  /** Helium price of the product; set only when the product has one (shows the "Helyumlu" box). */
  helium_price_kurus?: number | null;
  /** Normal (empty) price, kept so that the line can switch back from helium. */
  base_price_kurus?: number;
  /** Photo time of the product (for the thumbnail); null = no photo. */
  image_at?: string | null;
}

/** Largest quantity of one order line (the server rejects more). */
export const MAX_QUANTITY = 100000;

/**
 * Reads a quantity typed by the user. Returns the whole number, or an error text.
 * Empty, zero, negative and decimal values are errors.
 */
export function parseQuantity(text: string): number | string {
  const value = text.trim();
  if (!/^\d+$/.test(value) || Number(value) < 1) return "Adet 1 veya daha büyük bir tam sayı olmalı.";
  const quantity = Number(value);
  if (quantity > MAX_QUANTITY) return `Adet en fazla ${MAX_QUANTITY} olabilir.`;
  return quantity;
}

export function lineTotal(line: { unit_price_kurus: number; quantity: number }): number {
  return line.unit_price_kurus * line.quantity;
}

export function orderTotal(lines: { unit_price_kurus: number; quantity: number }[]): number {
  return lines.reduce((sum, line) => sum + lineTotal(line), 0);
}

type CartProduct = { id: number; barcode: string; name: string; price_kurus: number; helium_price_kurus?: number | null; image_at?: string | null };

const sameLine = (l: CartLine, productId: number, helium: boolean) => l.product_id === productId && !!l.helium === helium;

/** Adds one unit of a product: increases the quantity of an existing line or appends a new line. */
export function addToCart(lines: CartLine[], product: CartProduct, helium = false): CartLine[] {
  const heliumPrice = product.helium_price_kurus ?? null;
  const withHelium = helium && heliumPrice !== null;
  const existing = lines.find((l) => sameLine(l, product.id, withHelium));
  if (existing) {
    return lines.map((l) => (l === existing ? { ...l, quantity: l.quantity + 1 } : l));
  }
  return [
    ...lines,
    {
      product_id: product.id,
      barcode: product.barcode,
      name: product.name,
      unit_price_kurus: withHelium ? heliumPrice : product.price_kurus,
      quantity: 1,
      helium: withHelium,
      helium_price_kurus: heliumPrice,
      base_price_kurus: product.price_kurus,
      image_at: product.image_at ?? null,
    },
  ];
}

/**
 * Switches a line between empty and with helium. When the cart already has a line for the
 * other choice, the two lines become one.
 */
export function setLineHelium(lines: CartLine[], line: CartLine, helium: boolean): CartLine[] {
  if (line.helium_price_kurus === null || line.helium_price_kurus === undefined || !!line.helium === helium) return lines;
  const price = helium ? line.helium_price_kurus : (line.base_price_kurus ?? line.unit_price_kurus);
  const other = lines.find((l) => l !== line && sameLine(l, line.product_id, helium));
  if (other) {
    // The clicked line keeps its place in the list.
    return lines.filter((l) => l !== other).map((l) => (l === line ? { ...other, quantity: l.quantity + other.quantity } : l));
  }
  return lines.map((l) => (l === line ? { ...l, helium, unit_price_kurus: price } : l));
}
