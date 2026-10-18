import { createHash } from 'node:crypto';

/** Dataset holding a task's scalar outputs (title, price…) as one row. */
export const VALUES_DATASET = 'kết quả';

export interface RecordRow {
  dataset: string;
  /** Identity used to merge the same item across runs. */
  key: string;
  data: Record<string, unknown>;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

const hash = (v: unknown) => createHash('sha1').update(JSON.stringify(v)).digest('hex').slice(0, 20);

/** Natural keys that identify an item (post URL, product id…). */
const KEY_FIELDS = ['url', 'link', 'href', 'permalink', 'id', 'uid'];

function itemKey(item: Record<string, unknown>): string {
  for (const f of KEY_FIELDS) {
    const v = item[f];
    if ((typeof v === 'string' && v) || typeof v === 'number') return `${f}:${v}`;
  }
  return `h:${hash(item)}`;
}

/**
 * Splits a task result into rows:
 * - an array of objects → one row per object (dataset = variable name);
 * - an array of plain values → one row `{ value }` per element;
 * - an object → one row;
 * - all scalar outputs of the task → one row in "kết quả", keyed by the
 *   task's inputs so re-running the same input updates the same row.
 */
export function toRecords(
  result: Record<string, unknown> | null | undefined,
  task: { name?: string; vars?: Record<string, unknown> },
): RecordRow[] {
  const rows: RecordRow[] = [];
  const scalars: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(result ?? {})) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item === null || item === undefined || item === '') continue;
        const data = isPlainObject(item) ? item : { value: item };
        rows.push({ dataset: name, key: itemKey(data), data });
      }
    } else if (isPlainObject(value)) {
      rows.push({ dataset: name, key: itemKey(value), data: value });
    } else if (value !== null && value !== undefined) {
      scalars[name] = value;
    }
  }
  if (Object.keys(scalars).length) {
    rows.push({
      dataset: VALUES_DATASET,
      key: `in:${hash(task.vars ?? {})}`,
      data: { task: task.name, ...scalars },
    });
  }
  return rows;
}

/** Lower-cased text of a row for simple search. */
export function searchText(data: Record<string, unknown>): string {
  return JSON.stringify(data).toLowerCase().slice(0, 4000);
}

/** CSV with a BOM so Excel opens UTF-8 (Vietnamese) correctly. */
export function toCsv(columns: string[], rows: Array<Record<string, unknown>>): string {
  const cell = (v: unknown) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map(cell).join(','), ...rows.map((r) => columns.map((c) => cell(r[c])).join(','))];
  return `﻿${lines.join('\r\n')}\r\n`;
}

/** Union of keys, in first-seen order. */
export function columnsOf(rows: Array<Record<string, unknown>>): string[] {
  const cols = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) cols.add(k);
  return [...cols];
}
