import { LagDimension, LagFinding, LagPlayer } from './dto/lag-snapshot.dto';

export const NEARBY_RADIUS = 64;
const TICK_BUDGET_MS = 50;
/** Past 60% of the budget a dimension leaves little room for spikes before TPS drops. */
const DIMENSION_TICK_WARNING_MS = TICK_BUDGET_MS * 0.6;
const NEARBY_ENTITIES_WARNING = 300;
const NEARBY_ITEMS_WARNING = 200;
const UNATTENDED_ENTITIES_WARNING = 500;
const DOMINANT_TYPE_MIN_COUNT = 200;
const DOMINANT_TYPE_SHARE = 0.5;

function where(player: LagPlayer): string {
  const position = player.position
    ? ` em ${Math.round(player.position.x)} ${Math.round(player.position.y)} ${Math.round(player.position.z)}`
    : '';
  return `${player.dimension ?? 'dimensão desconhecida'}${position}`;
}

/** Fixed rules over the snapshot, warnings before notes; an empty list means nothing stood out. */
export function lagFindings(dimensions: LagDimension[], players: LagPlayer[]): LagFinding[] {
  const findings: LagFinding[] = [];

  for (const dimension of dimensions) {
    if (dimension.meanTickMs !== null && dimension.meanTickMs >= DIMENSION_TICK_WARNING_MS) {
      findings.push({
        severity: 'warning',
        message: `${dimension.id} gasta ${dimension.meanTickMs.toFixed(1)} ms por tick, de um orçamento de ${TICK_BUDGET_MS} ms para todo o servidor.`,
      });
    }
    if (
      dimension.players.length === 0 &&
      dimension.entities !== null &&
      dimension.entities >= UNATTENDED_ENTITIES_WARNING
    ) {
      findings.push({
        severity: 'warning',
        message: `${dimension.id} tem ${dimension.entities} entidades carregadas sem nenhum jogador lá: chunks forçados (forceload, chunk loaders de mods) mantêm essa área processando.`,
      });
    }
    const [top] = dimension.topEntities;
    // topEntities holds only the largest types, so their sum understates the dimension.
    const total =
      dimension.entities ?? dimension.topEntities.reduce((sum, entry) => sum + entry.count, 0);
    if (
      top &&
      total > 0 &&
      top.count >= DOMINANT_TYPE_MIN_COUNT &&
      top.count / total >= DOMINANT_TYPE_SHARE
    ) {
      findings.push({
        severity: 'warning',
        message: `${top.type} é a maioria das entidades em ${dimension.id} (${top.count} de ${total}).`,
      });
    }
  }

  for (const player of players) {
    if (player.nearbyEntities !== null && player.nearbyEntities >= NEARBY_ENTITIES_WARNING) {
      findings.push({
        severity: 'warning',
        message: `${player.nick} está perto de ${player.nearbyEntities} entidades num raio de ${NEARBY_RADIUS} blocos (${where(player)}): provável farm ou criação de animais.`,
      });
    }
    if (player.nearbyItems !== null && player.nearbyItems >= NEARBY_ITEMS_WARNING) {
      findings.push({
        severity: 'warning',
        message: `Há ${player.nearbyItems} itens no chão perto de ${player.nick} (${where(player)}): itens soltos pesam a cada tick até serem coletados ou sumirem.`,
      });
    }
  }

  if (players.length === 0) {
    findings.push({
      severity: 'info',
      message:
        'Nenhum jogador online: o retrato mostra só as dimensões, sem apontar quem está perto do que pesa.',
    });
  }

  return findings;
}
