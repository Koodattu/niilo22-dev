export function normalizeSearchText(input: string): string {
  return input
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function compactWhitespace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

export function clipText(input: string, maxLength = 220): string {
  const compact = compactWhitespace(input);
  if (compact.length <= maxLength) {
    return compact;
  }

  return `${compact.slice(0, maxLength - 1).trimEnd()}…`;
}
