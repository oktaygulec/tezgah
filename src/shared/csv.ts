// Product CSV: "barkod;ad;fiyat", semicolon separated, UTF-8 with or without BOM.

import { formatMoneyPlain, parseMoney } from "./money";

export interface CsvProductRow {
  line: number; // 1-based line number in the file
  barcode: string;
  name: string;
  price_kurus: number;
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
    if (fields.length !== 3) return fail(`3 sütun olmalı (barkod;ad;fiyat), ${fields.length} sütun var`);
    const [barcode, name, priceText] = fields as [string, string, string];
    if (!barcode) return fail("Barkod boş");
    if (/\s/.test(barcode)) return fail("Barkod boşluk içeremez");
    if (!name) return fail("Ürün adı boş");
    const price = parseMoney(priceText);
    if (price === null) return fail(`Fiyat anlaşılamadı: "${priceText}"`);
    const firstLine = seen.get(barcode);
    if (firstLine !== undefined) return fail(`Bu barkod dosyada ${firstLine}. satırda da var`);
    seen.set(barcode, line);
    rows.push({ line, barcode, name, price_kurus: price });
  });

  return { rows, errors };
}

function csvField(value: string): string {
  return /[;"\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** CSV text with BOM so that Excel opens Turkish characters correctly. */
export function productsToCsv(products: { barcode: string; name: string; price_kurus: number }[]): string {
  const lines = ["barkod;ad;fiyat"];
  for (const p of products) {
    lines.push([csvField(p.barcode), csvField(p.name), formatMoneyPlain(p.price_kurus)].join(";"));
  }
  return "﻿" + lines.join("\r\n") + "\r\n";
}
