export interface DiffPart {
  type: 'same' | 'del' | 'ins';
  text: string;
}

/**
 * Splits text into words (letters, marks, digits and the half-space stay together),
 * runs of whitespace, and single punctuation characters. Joining the tokens gives the text back.
 */
export function tokenize(text: string): string[] {
  return text.match(/[\p{L}\p{M}\p{N}\u{200C}]+|\s+|[^\p{L}\p{M}\p{N}\u{200C}\s]/gu) ?? [];
}

const MAX_CELLS = 4_000_000;

/**
 * Longest-common-subsequence diff of two token lists.
 * `key` decides when two tokens count as equal (e.g. a fold that ignores ي/ی); unchanged parts
 * are reported with the text of `a`.
 */
export function diffTokens(rawA: string[], rawB: string[], key?: (token: string) => string): DiffPart[] {
  const a = key ? rawA.map(key) : rawA;
  const b = key ? rawB.map(key) : rawB;
  const n = a.length;
  const m = b.length;
  const parts: DiffPart[] = [];
  const push = (type: DiffPart['type'], text: string) => {
    if (text === '') return;
    const last = parts[parts.length - 1];
    if (last && last.type === type) last.text += text;
    else parts.push({ type, text });
  };

  if (n * m > MAX_CELLS) {
    // Far too long for a quadratic table (never the case for sentences): show a plain replacement.
    push('del', rawA.join(''));
    push('ins', rawB.join(''));
    return parts;
  }

  // lcs[i][j] = length of the LCS of a[i..] and b[j..]
  const width = m + 1;
  const lcs = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * width + j] =
        a[i] === b[j] ? lcs[(i + 1) * width + j + 1] + 1 : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
    }
  }

  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push('same', rawA[i]);
      i++;
      j++;
    } else if (lcs[(i + 1) * width + j] >= lcs[i * width + j + 1]) {
      push('del', rawA[i]);
      i++;
    } else {
      push('ins', rawB[j]);
      j++;
    }
  }
  while (i < n) push('del', rawA[i++]);
  while (j < m) push('ins', rawB[j++]);
  return parts;
}

/** Word-level diff of two strings. With `key`, words that fold to the same form count as unchanged. */
export function diffWords(before: string, after: string, key?: (token: string) => string): DiffPart[] {
  return diffTokens(tokenize(before), tokenize(after), key);
}
