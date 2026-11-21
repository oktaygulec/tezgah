import { describe, expect, test } from "bun:test";
import { parseProductCsv, productsToCsv, splitCsvLine } from "../src/shared/csv";

describe("CSV import parsing", () => {
  test("header, BOM, Windows line endings and both price styles", () => {
    const text = "﻿barkod;ad;fiyat\r\n4006381333931;Kalem;12,50\r\n96385074;Silgi;7.25\r\n";
    const { rows, errors } = parseProductCsv(text);
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { line: 2, barcode: "4006381333931", name: "Kalem", price_kurus: 1250 },
      { line: 3, barcode: "96385074", name: "Silgi", price_kurus: 725 },
    ]);
  });

  test("works without a header and without BOM", () => {
    const { rows } = parseProductCsv("ABC-1;Defter;1.234,56");
    expect(rows).toEqual([{ line: 1, barcode: "ABC-1", name: "Defter", price_kurus: 123456 }]);
  });

  test("reports failed rows with line number and reason", () => {
    const text = [
      "barkod;ad;fiyat",
      "111;İğne;5",
      ";Boş barkod;5",
      "222;;5",
      "333;Fiyatsız;abc",
      "444;Eksik sütun",
      "111;Tekrar;6",
      "",
      "555;Doğru;3,00",
    ].join("\n");
    const { rows, errors } = parseProductCsv(text);
    expect(rows.map((r) => r.barcode)).toEqual(["111", "555"]);
    expect(errors.map((e) => e.line)).toEqual([3, 4, 5, 6, 7]);
    expect(errors[0]!.reason).toContain("Barkod boş");
    expect(errors[1]!.reason).toContain("Ürün adı boş");
    expect(errors[2]!.reason).toContain("Fiyat");
    expect(errors[3]!.reason).toContain("3 ile 5 arası sütun");
    expect(errors[4]!.reason).toContain("2. satırda");
    expect(errors[4]!.text).toBe("111;Tekrar;6");
  });

  test("quoted fields may contain semicolons and quotes", () => {
    expect(splitCsvLine('1;"Çay; 500 g";10')).toEqual(["1", "Çay; 500 g", "10"]);
    expect(splitCsvLine('1;"15"" monitör";10')).toEqual(["1", '15" monitör', "10"]);
  });

  test("export then import returns the same products", () => {
    const products = [
      { barcode: "4006381333931", name: "Kalem", price_kurus: 1250, stock_qty: 12, cost_kurus: 800 },
      { barcode: "X;1", name: 'Çay; "Rize"', price_kurus: 123456, stock_qty: -3, cost_kurus: undefined },
    ];
    const csv = productsToCsv(products);
    expect(csv.startsWith("﻿barkod;ad;fiyat;stok;alis_fiyati\r\n")).toBe(true);
    expect(csv).toContain("4006381333931;Kalem;12,50;12;8,00\r\n");
    const { rows, errors } = parseProductCsv(csv);
    expect(errors).toEqual([]);
    expect(rows.map(({ barcode, name, price_kurus, stock_qty, cost_kurus }) => ({ barcode, name, price_kurus, stock_qty, cost_kurus }))).toEqual(products);
  });

  test("optional purchase price column", () => {
    const { rows, errors } = parseProductCsv("1;A;5;;3,20\n2;B;5;1;\n3;C;5;1;abc");
    expect(rows.map((r) => [r.barcode, r.stock_qty, r.cost_kurus])).toEqual([["1", undefined, 320], ["2", 1, undefined]]);
    expect(errors[0]!.reason).toContain("Alış fiyatı");
  });

  test("optional stock column", () => {
    const { rows, errors } = parseProductCsv("barkod;ad;fiyat;stok\n1;A;5;10\n2;B;5;\n3;C;5\n4;D;5;2,5\n5;E;5;abc");
    expect(rows.map((r) => [r.barcode, r.stock_qty])).toEqual([["1", 10], ["2", undefined], ["3", undefined]]);
    expect(errors.map((e) => [e.line, e.reason.startsWith("Stok tam sayı")])).toEqual([[5, true], [6, true]]);
  });
});
