import type { SimulatedUserAccessResult } from '../../core/api';

/**
 * Monta o texto de confirmação quando uma ou mais perdas de acesso foram detectadas (#213).
 */
export function buildAccessLossConfirmationMessage(
  results: SimulatedUserAccessResult[],
  serverNameById: (id: string) => string,
): string {
  const parts: string[] = [];

  const affectedWithLosses = results.filter((r) => r.losses.length > 0);
  if (affectedWithLosses.length > 0) {
    const lossLines = affectedWithLosses.map((user) => {
      const serverTexts = user.losses.map((serverId) => {
        const name = serverNameById(serverId);
        return user.wouldBeKicked.includes(serverId)
          ? `${name} (online agora, será expulso)`
          : name;
      });
      return `• ${user.minecraftNick}: ${serverTexts.join(', ')}`;
    });
    parts.push(`Esta alteração removerá o acesso aos mundos:\n${lossLines.join('\n')}`);
  }

  const affectedWithGains = results.filter((r) => r.gains.length > 0);
  if (affectedWithGains.length > 0) {
    const gainLines = affectedWithGains.map((user) => {
      const serverTexts = user.gains.map((serverId) => serverNameById(serverId));
      return `• ${user.minecraftNick}: ${serverTexts.join(', ')}`;
    });
    parts.push(`Ganhos de acesso:\n${gainLines.join('\n')}`);
  }

  parts.push('Deseja confirmar e aplicar a alteração?');
  return parts.join('\n\n');
}

/**
 * Monta a mensagem de confirmação para exclusão de um grupo de acesso (#213).
 */
export function buildDeleteGroupConfirmationMessage(
  groupName: string,
  results: SimulatedUserAccessResult[],
  serverNameById: (id: string) => string,
): string {
  const intro = `O grupo "${groupName}" será apagado.`;
  const hasLosses = results.some((r) => r.losses.length > 0);

  if (hasLosses) {
    const lossPart = buildAccessLossConfirmationMessage(results, serverNameById);
    return `${intro}\n\n${lossPart}`;
  }

  return `${intro} Quem dependia dele pode perder o acesso aos servidores ligados a ele.\n\nDeseja confirmar a exclusão?`;
}
