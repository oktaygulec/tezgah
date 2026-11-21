import { describe, expect, test } from "bun:test";
import { formatMoney, formatMoneyPlain, parseMoney } from "../src/shared/money";

describe("parseMoney", () => {
  test.each([
    ["12,50", 1250],
    ["12.50", 1250],
    ["1.234,56", 123456],
    ["1,234.56", 123456],
    ["12", 1200],
    ["0,5", 50],
    ["0.05", 5],
    ["12,5", 1250],
    ["1.234", 123400], // single dot + 3 digits = thousands
    ["1.234.567,89", 123456789],
    [" ₺ 12,50 ", 1250],
    ["12,50 TL", 1250],
    ["0", 0],
  ])("%s -> %d kuruş", (input, kurus) => {
    expect(parseMoney(input)).toBe(kurus);
  });

  test.each(["", "abc", "12,505,1", "1,2,3", "12.345,6.7", "-5", "12,", ",50", "1.23.45", "12,345.678", "1e5"])(
    "rejects %p",
    (input) => {
      expect(parseMoney(input)).toBeNull();
    },
  );
});

describe("formatMoney", () => {
  test("Turkish lira format", () => {
    expect(formatMoney(1250)).toBe("₺12,50");
    expect(formatMoney(123456)).toBe("₺1.234,56");
    expect(formatMoney(0)).toBe("₺0,00");
  });

  test("plain format for CSV", () => {
    expect(formatMoneyPlain(1250)).toBe("12,50");
    expect(formatMoneyPlain(123456)).toBe("1234,56");
  });

  test("format then parse returns the same value", () => {
    for (const k of [0, 1, 99, 1250, 123456, 999999999]) {
      expect(parseMoney(formatMoney(k))).toBe(k);
      expect(parseMoney(formatMoneyPlain(k))).toBe(k);
    }
  });
});
