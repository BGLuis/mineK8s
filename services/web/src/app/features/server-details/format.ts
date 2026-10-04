/** "2 h 14 min", "38 min" or "menos de 1 min". */
export function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) {
    return `${hours} h ${minutes} min`;
  }
  return minutes > 0 ? `${minutes} min` : 'menos de 1 min';
}

const TYPE_LABELS: Record<string, string> = {
  PAPER: 'Paper',
  VANILLA: 'Vanilla',
  FABRIC: 'Fabric',
  FORGE: 'Forge',
  NEOFORGE: 'NeoForge',
};

export function serverTypeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type;
}
