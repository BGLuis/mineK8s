import { Injectable } from '@nestjs/common';

export interface UnlinkedAttempt {
  tailscaleUserId: string;
  loginName: string;
  displayName: string;
  clientIp: string;
  nodeId: string;
  nodeName: string;
  minecraftNick: string;
  attemptedAt: string;
}

@Injectable()
export class UnlinkedAttemptsService {
  private readonly attempts = new Map<string, UnlinkedAttempt>();
  private readonly MAX_ATTEMPTS = 20;

  record(attempt: Omit<UnlinkedAttempt, 'attemptedAt'> & { attemptedAt?: string | Date }): void {
    const key = attempt.tailscaleUserId || attempt.clientIp;
    if (!key) {
      return;
    }

    const attemptedAt =
      attempt.attemptedAt instanceof Date
        ? attempt.attemptedAt.toISOString()
        : typeof attempt.attemptedAt === 'string'
          ? attempt.attemptedAt
          : new Date().toISOString();

    this.attempts.set(key, {
      tailscaleUserId: attempt.tailscaleUserId,
      loginName: attempt.loginName || '',
      displayName: attempt.displayName || '',
      clientIp: attempt.clientIp,
      nodeId: attempt.nodeId || '',
      nodeName: attempt.nodeName || '',
      minecraftNick: attempt.minecraftNick || '',
      attemptedAt,
    });

    if (this.attempts.size > this.MAX_ATTEMPTS) {
      const oldestKey = Array.from(this.attempts.entries()).sort((a, b) =>
        a[1].attemptedAt.localeCompare(b[1].attemptedAt),
      )[0]?.[0];
      if (oldestKey) {
        this.attempts.delete(oldestKey);
      }
    }
  }

  list(): UnlinkedAttempt[] {
    return Array.from(this.attempts.values()).sort((a, b) =>
      b.attemptedAt.localeCompare(a.attemptedAt),
    );
  }

  dismiss(key: string): void {
    this.attempts.delete(key);
  }

  clear(): void {
    this.attempts.clear();
  }
}
