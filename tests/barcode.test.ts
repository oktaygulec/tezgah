import { describe, expect, test } from "bun:test";
import {
  detectBarcodeFormat,
  ean13Warning,
  gs1CheckDigit,
  isValidEan13,
  isValidEan8,
  isValidUpcA,
  makeInStoreEan13,
  nextInStoreEan13,
} from "../src/shared/barcode";

describe("check digits", () => {
  test("EAN-13", () => {
    expect(gs1CheckDigit("400638133393")).toBe(1);
    expect(gs1CheckDigit("869000000000")).toBe(5);
    expect(isValidEan13("4006381333931")).toBe(true);
    expect(isValidEan13("4006381333932")).toBe(false);
    expect(isValidEan13("400638133393")).toBe(false); // 12 digits
    expect(isValidEan13("40063813339A1")).toBe(false);
  });

  test("EAN-8", () => {
    expect(gs1CheckDigit("9638507")).toBe(4);
    expect(isValidEan8("96385074")).toBe(true);
    expect(isValidEan8("96385075")).toBe(false);
  });

  test("UPC-A", () => {
    expect(isValidUpcA("036000291452")).toBe(true);
    expect(isValidUpcA("036000291453")).toBe(false);
  });

  test("check digit 0 case", () => {
    expect(gs1CheckDigit("000000000000")).toBe(0);
  });

  test("rejects non-digits", () => {
    expect(() => gs1CheckDigit("12a")).toThrow();
  });

  test("warning only for 13 digits with a wrong check digit", () => {
    expect(ean13Warning("4006381333931")).toBeNull();
    expect(ean13Warning("4006381333932")).toContain("1 olmalı");
    expect(ean13Warning("ABC123")).toBeNull();
    expect(ean13Warning("96385075")).toBeNull();
  });
});

describe("in-store EAN-13", () => {
  test("prefix 2, 11-digit sequence and a valid check digit", () => {
    expect(makeInStoreEan13(1)).toBe("2000000000015");
    expect(makeInStoreEan13(2)).toBe("2000000000022");
    expect(makeInStoreEan13(123456)).toMatch(/^200000123456\d$/);
    for (const seq of [1, 9, 10, 99999, 12345678901]) expect(isValidEan13(makeInStoreEan13(seq))).toBe(true);
  });

  test("rejects bad sequence numbers", () => {
    expect(() => makeInStoreEan13(0)).toThrow();
    expect(() => makeInStoreEan13(1.5)).toThrow();
    expect(() => makeInStoreEan13(100000000000)).toThrow();
  });

  test("next free code", () => {
    expect(nextInStoreEan13([])).toBe("2000000000015");
    expect(nextInStoreEan13(["2000000000015", "2000000000022"])).toBe(makeInStoreEan13(3));
    // Other barcodes and invalid "2..." codes do not count.
    expect(nextInStoreEan13(["4006381333931", "2999999999990", "ABC"])).toBe("2000000000015");
    expect(nextInStoreEan13([makeInStoreEan13(41)])).toBe(makeInStoreEan13(42));
  });
});

describe("barcode type detection", () => {
  test.each([
    ["4006381333931", "EAN13"],
    ["2000000000015", "EAN13"],
    ["4006381333932", "CODE128"], // wrong check digit
    ["96385074", "EAN8"],
    ["96385075", "CODE128"],
    ["036000291452", "CODE128"], // UPC-A is printed as Code 128
    ["ABC-123", "CODE128"],
    ["12345", "CODE128"],
  ])("%s -> %s", (code, format) => {
    expect(detectBarcodeFormat(code)).toBe(format as never);
  });
});
