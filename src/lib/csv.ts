/** Small RFC 4180 CSV parser (quotes, escaped quotes, CRLF). */
export function parseCsv(text: string, delimiter = ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    if (row.some((f) => f !== "")) rows.push(row);
  }
  return rows;
}

export function detectDelimiter(firstLine: string) {
  const counts = [",", ";", "\t", "|"].map((d) => [d, firstLine.split(d).length] as const);
  return counts.sort((a, b) => b[1] - a[1])[0][0];
}

/** Parse CSV into objects keyed by header, finding the header row within the first lines. */
export function csvObjects(text: string, headerHint?: RegExp): Record<string, string>[] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const rows = parseCsv(text, detectDelimiter(firstLine));
  let headerIdx = 0;
  if (headerHint) {
    const found = rows.slice(0, 15).findIndex((r) => r.some((c) => headerHint.test(c)));
    if (found >= 0) headerIdx = found;
  }
  const header = (rows[headerIdx] ?? []).map((h) => h.trim());
  return rows.slice(headerIdx + 1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()])));
}
