// Barcode helpers shared by server, web and tests.

export type BarcodeFormat = "EAN13" | "EAN8" | "CODE128";

/** In-store EAN-13 codes start with this digit (GS1 "restricted circulation" range). */
export const IN_STORE_PREFIX = "2";
const IN_STORE_SEQ_DIGITS = 11; // 1 prefix + 11 sequence + 1 check = 13
export const IN_STORE_MAX_SEQ = 10 ** IN_STORE_SEQ_DIGITS - 1;

/**
 * GS1 check digit for a payload without its check digit
 * (12 digits for EAN-13, 7 for EAN-8, 11 for UPC-A).
 * Weights alternate 3,1,3,1... starting from the rightmost payload digit.
 */
export function gs1CheckDigit(payload: string): number {
  if (!/^\d+$/.test(payload)) throw new Error(`Barkod yalnızca rakam içermeli: ${payload}`);
  let sum = 0;
  for (let i = 0; i < payload.length; i++) {
    const digit = payload.charCodeAt(payload.length - 1 - i) - 48;
    sum += digit * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}

function hasValidCheckDigit(code: string, length: number): boolean {
  if (code.length !== length || !/^\d+$/.test(code)) return false;
  return gs1CheckDigit(code.slice(0, -1)) === Number(code[code.length - 1]);
}

export const isValidEan13 = (code: string) => hasValidCheckDigit(code, 13);
export const isValidEan8 = (code: string) => hasValidCheckDigit(code, 8);
export const isValidUpcA = (code: string) => hasValidCheckDigit(code, 12);

/** Which symbology to print for a stored barcode text. */
export function detectBarcodeFormat(code: string): BarcodeFormat {
  if (isValidEan13(code)) return "EAN13";
  if (isValidEan8(code)) return "EAN8";
  return "CODE128";
}

/**
 * Warning text for a hand-typed 13-digit code with a wrong check digit,
 * or null when there is nothing to warn about.
 */
export function ean13Warning(code: string): string | null {
  if (!/^\d{13}$/.test(code) || isValidEan13(code)) return null;
  const expected = gs1CheckDigit(code.slice(0, 12));
  return `Kontrol hanesi hatalı: son rakam ${expected} olmalı. Yine de kaydedebilirsiniz.`;
}

/** Builds the in-store EAN-13 for a sequence number: "2" + 11-digit sequence + check digit. */
export function makeInStoreEan13(seq: number): string {
  if (!Number.isInteger(seq) || seq < 1 || seq > IN_STORE_MAX_SEQ) {
    throw new Error(`Geçersiz barkod sıra numarası: ${seq}`);
  }
  const payload = IN_STORE_PREFIX + String(seq).padStart(IN_STORE_SEQ_DIGITS, "0");
  return payload + gs1CheckDigit(payload);
}

/** Next free in-store code, given every barcode already in use. */
export function nextInStoreEan13(existing: Iterable<string>): string {
  const used = new Set(existing);
  let max = 0;
  for (const code of used) {
    if (code.startsWith(IN_STORE_PREFIX) && isValidEan13(code)) {
      max = Math.max(max, Number(code.slice(1, 12)));
    }
  }
  for (let seq = max + 1; seq <= IN_STORE_MAX_SEQ; seq++) {
    const code = makeInStoreEan13(seq);
    if (!used.has(code)) return code;
  }
  throw new Error("Mağaza içi barkod numaraları tükendi.");
}
