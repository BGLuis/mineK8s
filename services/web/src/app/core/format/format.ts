const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "agora", "há 5 min", "há 3 h", "há 2 dias". Missing or future dates read as "—" and "agora". */
export function formatRelative(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) {
    return '—';
  }
  const elapsed = now - new Date(iso).getTime();
  if (Number.isNaN(elapsed)) {
    return '—';
  }
  if (elapsed < MINUTE) {
    return 'agora';
  }
  if (elapsed < HOUR) {
    return `há ${Math.floor(elapsed / MINUTE)} min`;
  }
  if (elapsed < DAY) {
    return `há ${Math.floor(elapsed / HOUR)} h`;
  }
  const days = Math.floor(elapsed / DAY);
  return `há ${days} ${days === 1 ? 'dia' : 'dias'}`;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** dd/mm in the viewer's time zone. */
export function formatShortDate(iso: string): string {
  const date = new Date(iso);
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}`;
}

/** dd/mm às HH:mm in the viewer's time zone. */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return `${formatShortDate(iso)} às ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Moves focus to the first field flagged `aria-invalid` once the error state has rendered. */
export function focusFirstInvalid(root: HTMLElement): void {
  setTimeout(() => root.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
}
