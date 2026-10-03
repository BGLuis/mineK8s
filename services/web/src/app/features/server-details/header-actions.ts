import { ServerState } from '../../core/api/models';
import { PrimaryAction, serverPrimaryAction } from '../../ui';

export interface HeaderActions {
  /** The Parar / Ligar slot. */
  power: PrimaryAction;
  restartEnabled: boolean;
}

/**
 * Header buttons for a lifecycle state. The card's primary action for CRASHED is "Reiniciar",
 * but the header already has a dedicated Reiniciar button, so its power slot offers "Ligar".
 */
export function headerActions(state: ServerState): HeaderActions {
  const primary = serverPrimaryAction(state);
  return {
    power: primary.kind === 'restart' ? serverPrimaryAction('STOPPED') : primary,
    restartEnabled: state === 'READY' || state === 'CRASHED',
  };
}
