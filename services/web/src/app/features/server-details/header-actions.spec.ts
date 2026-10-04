import { ServerState } from '../../core/api/models';
import { headerActions } from './header-actions';

describe('headerActions', () => {
  it('offers Parar (danger, stop) for a running server and allows restart', () => {
    const { power, restartEnabled } = headerActions('READY');

    expect(power).toMatchObject({ kind: 'stop', label: 'Parar', variant: 'danger' });
    expect(restartEnabled).toBe(true);
  });

  it('offers Ligar (primary, start) for a hibernating server and blocks restart', () => {
    const { power, restartEnabled } = headerActions('STOPPED');

    expect(power).toMatchObject({ kind: 'start', label: 'Ligar', variant: 'primary' });
    expect(restartEnabled).toBe(false);
  });

  it('offers Ligar for a crashed server instead of repeating Reiniciar, which has its own button', () => {
    const { power, restartEnabled } = headerActions('CRASHED');

    expect(power).toMatchObject({ kind: 'start', label: 'Ligar' });
    expect(restartEnabled).toBe(true);
  });

  it.each<ServerState>(['STARTING', 'STOPPING', 'UPDATING', 'PROVISIONING', 'FAILED'])(
    'disables the power button and restart while %s',
    (state) => {
      const { power, restartEnabled } = headerActions(state);

      expect(power.kind).toBe('none');
      expect(power.disabled).toBe(true);
      expect(restartEnabled).toBe(false);
    },
  );
});
