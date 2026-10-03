const VISIBLE_HEAD = 15;
const VISIBLE_TAIL = 4;

/** "tskey-auth-k8Fq…92xZ": enough to recognise the key without exposing it to a shoulder surfer. */
export function maskAuthKey(key: string): string {
  if (key.length <= VISIBLE_HEAD + VISIBLE_TAIL) {
    return key;
  }
  return `${key.slice(0, VISIBLE_HEAD)}…${key.slice(-VISIBLE_TAIL)}`;
}

/** The magic link is opened with location.assign, so only the Tailscale scheme may ever be followed. */
export function isTailscaleDeepLink(url: string): boolean {
  return url.startsWith('tailscale://');
}

export const TAILSCALE_DOWNLOADS = [
  { label: 'Windows', href: 'https://tailscale.com/download/windows' },
  { label: 'macOS', href: 'https://tailscale.com/download/mac' },
  { label: 'Linux', href: 'https://tailscale.com/download/linux' },
  { label: 'Android', href: 'https://play.google.com/store/apps/details?id=com.tailscale.ipn' },
  { label: 'iOS', href: 'https://apps.apple.com/app/tailscale/id1470499037' },
] as const;
