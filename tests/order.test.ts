import { describe, expect, test } from "bun:test";
import { setLineHelium, addToCart, lineTotal, MAX_QUANTITY, orderTotal, parseQuantity, type CartLine } from "../src/shared/order";

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
    expect(cart).toHaveLength(1);
    expect(cart[0]).toMatchObject({ product_id: 1, barcode: tea.barcode, name: "Çay", unit_price_kurus: 1250, quantity: 1, helium: false });
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

describe("helium lines", () => {
  const balloon = { id: 7, barcode: "7", name: "Balon", price_kurus: 10000, helium_price_kurus: 40000 };

  test("empty and helium are separate lines", () => {
    let cart = addToCart([], balloon);
    cart = addToCart(cart, balloon, true);
    cart = addToCart(cart, balloon, true);
    expect(cart.map((l) => [l.helium, l.unit_price_kurus, l.quantity])).toEqual([
      [false, 10000, 1],
      [true, 40000, 2],
    ]);
  });

  test("helium is ignored for a product without a helium price", () => {
    const cart = addToCart([], { id: 1, barcode: "1", name: "Kalem", price_kurus: 500 }, true);
    expect(cart[0]).toMatchObject({ helium: false, unit_price_kurus: 500 });
  });

  test("switching a line changes its price and joins an existing line", () => {
    let cart = addToCart([], balloon);
    cart = setLineHelium(cart, cart[0]!, true);
    expect(cart[0]).toMatchObject({ helium: true, unit_price_kurus: 40000 });
    cart = addToCart(cart, balloon);
    cart = setLineHelium(cart, cart[1]!, true);
    expect(cart).toHaveLength(1);
    expect(cart[0]).toMatchObject({ helium: true, quantity: 2 });
    cart = setLineHelium(cart, cart[0]!, false);
    expect(cart[0]).toMatchObject({ helium: false, unit_price_kurus: 10000, quantity: 2 });
  });
});

describe("parseQuantity", () => {
  test("accepts whole numbers from 1 to MAX_QUANTITY", () => {
    expect(parseQuantity("1")).toBe(1);
    expect(parseQuantity(" 25 ")).toBe(25);
    expect(parseQuantity(String(MAX_QUANTITY))).toBe(MAX_QUANTITY);
  });

  test("rejects empty, zero, negative, decimal and too large values", () => {
    for (const text of ["", "0", "-3", "2.5", "1e3", "abc", String(MAX_QUANTITY + 1), "8690000000005"]) {
      expect(typeof parseQuantity(text)).toBe("string");
    }
  });
});
