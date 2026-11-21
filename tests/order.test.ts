import { describe, expect, test } from "bun:test";
import { addToCart, lineTotal, orderTotal, type CartLine } from "../src/shared/order";

const tea = { id: 1, barcode: "2000000000015", name: "Çay", price_kurus: 1250 };
const bread = { id: 2, barcode: "2000000000022", name: "Ekmek", price_kurus: 1000 };

describe("order totals", () => {
  test("line total = unit price x quantity", () => {
    expect(lineTotal({ unit_price_kurus: 1250, quantity: 3 })).toBe(3750);
  });

  test("order total sums the lines", () => {
    expect(orderTotal([])).toBe(0);
    expect(
      orderTotal([
        { unit_price_kurus: 1250, quantity: 3 },
        { unit_price_kurus: 199, quantity: 1 },
        { unit_price_kurus: 5, quantity: 10 },
      ]),
    ).toBe(3750 + 199 + 50);
  });

  test("integer kuruş avoids floating point errors", () => {
    // 0.10 + 0.20 in floats is 0.30000000000000004
    expect(orderTotal([{ unit_price_kurus: 10, quantity: 1 }, { unit_price_kurus: 20, quantity: 1 }])).toBe(30);
  });
});

describe("addToCart", () => {
  test("a new product adds a line with quantity 1", () => {
    const cart = addToCart([], tea);
    expect(cart).toEqual([{ product_id: 1, barcode: tea.barcode, name: "Çay", unit_price_kurus: 1250, quantity: 1 }]);
  });

  test("scanning the same product again increases the quantity", () => {
    let cart: CartLine[] = [];
    cart = addToCart(cart, tea);
    cart = addToCart(cart, bread);
    cart = addToCart(cart, tea);
    expect(cart.map((l) => [l.name, l.quantity])).toEqual([["Çay", 2], ["Ekmek", 1]]);
    expect(orderTotal(cart)).toBe(2 * 1250 + 1000);
  });

  test("does not change the old cart", () => {
    const first = addToCart([], tea);
    addToCart(first, tea);
    expect(first[0]!.quantity).toBe(1);
  });
});
