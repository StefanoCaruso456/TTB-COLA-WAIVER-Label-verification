const SMART_QUOTE_MAP: Record<string, string> = {
  "‘": "'",
  "’": "'",
  "“": '"',
  "”": '"',
  "′": "'",
  "″": '"',
};

const TRADEMARK_SYMBOLS = /[™®©]/g;

export function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

export function normalizeSmartQuotes(input: string): string {
  return input.replace(/[‘’“”′″]/g, (ch) =>
    SMART_QUOTE_MAP[ch] ?? ch,
  );
}

/**
 * Strips ASCII and smart apostrophes entirely so that "Stone's" and "Stones"
 * normalize to the same form. Other punctuation is replaced with spaces in
 * stripPunctuation; apostrophes get special-cased because brand variations
 * routinely differ only in apostrophe presence.
 */
export function stripApostrophes(input: string): string {
  return input.replace(/['’‘′]/g, "");
}

export function stripTrademarkSymbols(input: string): string {
  return input.replace(TRADEMARK_SYMBOLS, "");
}

export function stripPunctuation(input: string): string {
  return input.replace(/[‐-―.,;:!?()\[\]{}"]/g, " ");
}

export function normalizeText(input: string | null | undefined): string {
  if (!input) return "";
  let s = String(input);
  s = normalizeSmartQuotes(s);
  s = stripTrademarkSymbols(s);
  s = stripApostrophes(s);
  s = s.toLowerCase();
  s = stripPunctuation(s);
  s = normalizeWhitespace(s);
  return s;
}

/**
 * Levenshtein distance, for brand-name fuzzy comparison. Small inputs only.
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = b.charAt(i - 1) === a.charAt(j - 1) ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }
  return matrix[b.length][a.length];
}

export function similarity(a: string, b: string): number {
  if (!a && !b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}
