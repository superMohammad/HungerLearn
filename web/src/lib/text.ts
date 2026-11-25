/** Pure text helpers shared by verification (no I/O). */

const TASHKEEL = /[ؐ-ًؚ-ٰٟۖ-ۭ]/g;
const TATWEEL = /ـ/g;
const ARABIC_INDIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const PUNCTUATION = /[«»"“”'‘’.,،؛;:!?؟()\[\]{}\-–—_/\\]/g;

function foldDigits(text: string): string {
  return text.replace(/[٠-٩۰-۹]/g, (ch) => {
    const arabic = ARABIC_INDIC_DIGITS.indexOf(ch);
    return String(arabic >= 0 ? arabic : PERSIAN_DIGITS.indexOf(ch));
  });
}

/**
 * Folds forms that do not change meaning: tashkeel, tatweel, alef/yaa/taa-marbuta variants,
 * Arabic-Indic digits, case, punctuation, and whitespace. Never drops words or numbers.
 */
export function normalizeText(text: string): string {
  return foldDigits(text.normalize("NFKC"))
    .replace(TASHKEEL, "")
    .replace(TATWEEL, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(PUNCTUATION, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Check 1 of the anti-hallucination gate: the item's quote must exist inside its clause. */
export function quoteInClause(quote: string, clauseQuote: string): boolean {
  const q = normalizeText(quote);
  return q.length >= 3 && normalizeText(clauseQuote).includes(q);
}
