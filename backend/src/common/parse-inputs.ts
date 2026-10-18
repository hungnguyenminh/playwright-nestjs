/** Same parser as frontend/utils/parseInputs.ts (job Inputs box), used to check AI proposals. */
/** One CSV line → cells; supports "quoted, cells" and "" escapes. */
function splitCsvLine(line: string, sep: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      cells.push(cur);
      cur = '';
    } else cur += ch;
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}

/**
 * Task inputs pasted by the user: a JSON array of objects, or CSV / TSV
 * with a header row (column names become variable names).
 */
export function parseInputs(text: string): Record<string, unknown>[] {
  const src = text.trim();
  if (!src) return [];
  if (src.startsWith('[') || src.startsWith('{')) {
    const parsed = JSON.parse(src);
    const list = Array.isArray(parsed) ? parsed : [parsed];
    if (!list.every((x) => x && typeof x === 'object' && !Array.isArray(x))) {
      throw new Error('JSON must be an array of objects');
    }
    return list;
  }
  const lines = src.split(/\r?\n/).filter((l) => l.trim());
  const sep = lines[0].includes('\t') ? '\t' : ',';
  const headers = splitCsvLine(lines[0], sep);
  if (headers.some((h) => !h))
    throw new Error('CSV header has an empty column name');
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line, sep);
    return Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? '']));
  });
}
