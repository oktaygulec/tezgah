import { describe, expect, test } from "bun:test";
import { DEFAULT_SETTINGS, settingsErrors, validateSettings } from "../src/shared/types";
import { barcodeError, nameError, priceKurusError, priceTextError } from "../src/shared/validate";

describe("product field rules", () => {
  test("barcode", () => {
    expect(barcodeError("4006381333931")).toBeNull();
    expect(barcodeError("ABC-12/34.5")).toBeNull();
    expect(barcodeError("")).toContain("boş");
    expect(barcodeError("12 34")).toContain("boşluk");
    expect(barcodeError("X".repeat(65))).toContain("64");
    expect(barcodeError("ÇAY123")).toContain("Türkçe harf");
  });

  test("name", () => {
    expect(nameError("Çay Rize 500 g")).toBeNull();
    expect(nameError("")).toContain("boş");
    expect(nameError("a".repeat(201))).toContain("200");
    expect(nameError("a\tb")).toContain("geçersiz");
  });

  test("price text", () => {
    expect(priceTextError("12,50")).toBeNull();
    expect(priceTextError("0")).toBeNull();
    expect(priceTextError("")).toContain("boş");
    expect(priceTextError("-5")).toContain("eksi");
    expect(priceTextError("abc")).toContain("Örnek");
    expect(priceTextError("12,505,1")).toContain("anlaşılamadı");
  });

  test("price in kuruş", () => {
    expect(priceKurusError(1250)).toBeNull();
    expect(priceKurusError(-1)).toContain("eksi");
    expect(priceKurusError(1.5)).toContain("geçersiz");
    expect(priceKurusError("12")).toContain("geçersiz");
    expect(priceKurusError(100_000_000_01)).toContain("en fazla");
  });
});

describe("settings rules", () => {
  test("defaults are valid", () => {
    expect(settingsErrors(DEFAULT_SETTINGS)).toEqual({});
    expect(validateSettings(DEFAULT_SETTINGS)).toBeNull();
  });

  test("one message per invalid field", () => {
    const errors = settingsErrors({ ...DEFAULT_SETTINGS, label_width_mm: Number.NaN, print_density: 3.5, print_speed: 9 });
    expect(Object.keys(errors).sort()).toEqual(["label_width_mm", "print_density", "print_speed"]);
    expect(errors.label_width_mm).toContain("sayı");
    expect(errors.print_density).toContain("tam sayı");
    expect(errors.print_speed).toContain("1 ile 6");
  });

  test("fields that depend on each other", () => {
    expect(settingsErrors({ ...DEFAULT_SETTINGS, label_height_mm: 20, label_margin_mm: 10 }).label_margin_mm).toContain("çok büyük");
    expect(settingsErrors({ ...DEFAULT_SETTINGS, label_height_mm: 15, barcode_height_mm: 13 }).barcode_height_mm).toContain("iç yüksekliğinden");
  });
});
