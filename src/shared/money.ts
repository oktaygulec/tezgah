// Money is always an integer number of kuruş (1 TL = 100 kuruş).

const currency = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" });
const plain = new Intl.NumberFormat("tr-TR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: false,
});

export const MAX_PRICE_KURUS = 100_000_000_00; // 100 million TL

/** "₺12,50" */
export function formatMoney(kurus: number): string {
  return currency.format(kurus / 100);
}

/** "12,50" (no symbol, no grouping) for CSV and form fields. */
export function formatMoneyPlain(kurus: number): string {
  return plain.format(kurus / 100);
}

/**
 * Parses a price typed by a person. Accepts "12,50", "12.50", "1.234,56",
 * "1,234.56", "1234", "₺12,50". Returns kuruş, or null when the text is not a price.
 * Rules: when both "." and "," appear, the last one is the decimal separator.
 * A single separator followed by exactly 3 digits is a thousands separator
 * ("1.234" = 1234 TL); otherwise it is the decimal separator.
 */
export function parseMoney(input: string): number | null {
  const text = input.replace(/[\s ₺]|TL$/gi, "");
  if (!/^\d[\d.,]*$/.test(text)) return null;

  const lastDot = text.lastIndexOf(".");
  const lastComma = text.lastIndexOf(",");
  let intPart: string;
  let fracPart = "";
  let hasDecimal = false;

  if (lastDot >= 0 && lastComma >= 0) {
    const decimalSep = lastDot > lastComma ? "." : ",";
    const groupSep = decimalSep === "." ? "," : ".";
    const at = text.lastIndexOf(decimalSep);
    intPart = text.slice(0, at);
    fracPart = text.slice(at + 1);
    hasDecimal = true;
    if (intPart.includes(decimalSep) || !isGrouped(intPart, groupSep)) return null;
    intPart = intPart.split(groupSep).join("");
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? "." : ",";
    const parts = text.split(sep);
    const lastGroup = parts[parts.length - 1]!;
    if (parts.length > 2 || lastGroup.length === 3) {
      // thousands separator only
      if (!isGrouped(text, sep)) return null;
      intPart = parts.join("");
    } else {
      intPart = parts[0]!;
      fracPart = lastGroup;
      hasDecimal = true;
    }
  } else {
    intPart = text;
  }

  if (!/^\d+$/.test(intPart) || !(hasDecimal ? /^\d{1,2}$/ : /^$/).test(fracPart)) return null;
  const kurus = Number(intPart) * 100 + Number(fracPart.padEnd(2, "0"));
  if (!Number.isSafeInteger(kurus) || kurus > MAX_PRICE_KURUS) return null;
  return kurus;
}

/** "1.234.567" style grouping: first group 1-3 digits, the rest exactly 3. */
function isGrouped(text: string, sep: string): boolean {
  const groups = text.split(sep);
  if (groups.length === 1) return /^\d+$/.test(text);
  return /^\d{1,3}$/.test(groups[0]!) && groups.slice(1).every((g) => /^\d{3}$/.test(g));
}
