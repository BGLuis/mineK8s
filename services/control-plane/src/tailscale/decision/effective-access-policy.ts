import { Server } from '../../database/entities/server.entity';
import { ServerContext } from './access-decision-engine.service';

/**
 * O Gateway só conhece políticas, então o modo manutenção vira a política MAINTENANCE
 * (que nega a todos exceto ADMIN). Tudo que decide acesso deve passar por aqui.
 */
export function effectiveAccessPolicy(
  server: Pick<Server, 'access_policy' | 'is_maintenance'>,
): ServerContext['policy'] {
  return server.is_maintenance ? 'MAINTENANCE' : server.access_policy || 'GROUP';
}
