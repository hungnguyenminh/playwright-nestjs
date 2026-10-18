const pad = (n: number) => String(n).padStart(2, '0');

/** "18/10/2026 09:30" */
export function fmtDate(value?: string | number | Date | null): string {
  if (!value) return '—';
  const d = new Date(value);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "09:30:20" */
export function fmtTime(value?: string | number | Date | null): string {
  if (!value) return '—';
  const d = new Date(value);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
