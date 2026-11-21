// Product CSV: "barkod;ad;fiyat" with an optional 4th column "stok". Semicolon separated, UTF-8 with or without BOM.

import { formatMoneyPlain, parseMoney } from "./money";
import { MAX_STOCK_QUANTITY } from "./stock";
import { barcodeError, nameError } from "./validate";

export interface CsvProductRow {
  line: number; // 1-based line number in the file
  barcode: string;
  name: string;
  price_kurus: number;
  /** Set when the row has a value in the "stok" column. */
  stock_qty?: number;
}

export interface CsvRowError {
  line: number;
  text: string;
  reason: string;
}

export interface CsvParseResult {
  rows: CsvProductRow[];
  errors: CsvRowError[];
}

/** Splits one line on ";" and supports "quoted; fields" with "" as an escaped quote. */
export function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"' && field.trim() === "") {
      quoted = true;
      field = "";
    } else if (ch === ";") {
      fields.push(field);
      field = "";
    } else {
      field += ch;
    }
  }
  fields.push(field);
  return fields.map((f) => f.trim());
}

export function parseProductCsv(text: string): CsvParseResult {
  const rows: CsvProductRow[] = [];
  const errors: CsvRowError[] = [];
  const seen = new Map<string, number>();
  const lines = text.replace(/^﻿/, "").split(/\r\n|\n|\r/);

  lines.forEach((raw, index) => {
    const line = index + 1;
    if (raw.trim() === "") return;
    const fields = splitCsvLine(raw);
    if (index === 0 && fields[0]?.toLocaleLowerCase("tr-TR") === "barkod") return; // header

    const fail = (reason: string) => errors.push({ line, text: raw, reason });
    if (fields.length !== 3 && fields.length !== 4) {
      return fail(`3 veya 4 sütun olmalı (barkod;ad;fiyat;stok), ${fields.length} sütun var`);
    }
    const [barcode, name, priceText, stockText = ""] = fields as [string, string, string, string?];
    const fieldError = barcodeError(barcode) ?? nameError(name);
    if (fieldError) return fail(fieldError);
    const price = parseMoney(priceText);
    if (price === null) return fail(`Fiyat anlaşılamadı: "${priceText}"`);
    const firstLine = seen.get(barcode);
    let stock: number | undefined;
    if (stockText !== "") {
      stock = /^-?\d+$/.test(stockText) ? Number(stockText) : Number.NaN;
      if (!Number.isSafeInteger(stock) || Math.abs(stock) > MAX_STOCK_QUANTITY) return fail(`Stok tam sayı olmalı: "${stockText}"`);
    }
    if (firstLine !== undefined) return fail(`Bu barkod dosyada ${firstLine}. satırda da var`);
    seen.set(barcode, line);
    rows.push(stock === undefined ? { line, barcode, name, price_kurus: price } : { line, barcode, name, price_kurus: price, stock_qty: stock });
  });

  return { rows, errors };
}

function csvField(value: string): string {
  return /[;"\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** CSV text with BOM so that Excel opens Turkish characters correctly. */
export function productsToCsv(products: { barcode: string; name: string; price_kurus: number; stock_qty: number }[]): string {
  const lines = ["barkod;ad;fiyat;stok"];
  for (const p of products) {
    lines.push([csvField(p.barcode), csvField(p.name), formatMoneyPlain(p.price_kurus), String(p.stock_qty)].join(";"));
  }
  return "﻿" + lines.join("\r\n") + "\r\n";
}
