import { SessionEventType, SessionLifecycleEvent } from './gateway-ipc.interfaces';
import { ServerActivityBus } from '../server-events/server-activity.bus';
import { PlayerSessionsService } from './player-sessions.service';

const event = (overrides: Partial<SessionLifecycleEvent>): SessionLifecycleEvent => ({
  event_type: SessionEventType.CONNECTED,
  session_id: 's1',
  server_id: 'srv-1',
  client_ip: '100.64.0.2',
  minecraft_nick: 'Steve',
  timestamp_epoch_ms: Date.parse('2026-10-03T12:00:00Z'),
  reason: '',
  ...overrides,
});

describe('PlayerSessionsService', () => {
  let sessions: PlayerSessionsService;

  beforeEach(() => {
    sessions = new PlayerSessionsService();
  });

  it('CONNECTED aumenta a contagem do servidor e DISCONNECTED diminui', () => {
    sessions.connected(event({ session_id: 's1', minecraft_nick: 'Steve' }));
    sessions.connected(event({ session_id: 's2', minecraft_nick: 'Alex' }));
    expect(sessions.count('srv-1')).toBe(2);

    sessions.disconnected(event({ session_id: 's1' }));

    expect(sessions.count('srv-1')).toBe(1);
    expect(sessions.list('srv-1').map((s) => s.nick)).toEqual(['Alex']);
  });

  it('guarda nick, IP e início da sessão a partir do evento', () => {
    sessions.connected(event({}));

    expect(sessions.list('srv-1')).toEqual([
      {
        sessionId: 's1',
        nick: 'Steve',
        ip: '100.64.0.2',
        connectedAt: new Date('2026-10-03T12:00:00Z'),
      },
    ]);
  });

  it('conta por servidor, sem misturar jogadores de servidores diferentes', () => {
    sessions.connected(event({ server_id: 'srv-1' }));
    sessions.connected(event({ server_id: 'srv-2', session_id: 's9', minecraft_nick: 'Alex' }));

    expect(sessions.count('srv-1')).toBe(1);
    expect(sessions.count('srv-2')).toBe(1);
    expect(sessions.count('srv-3')).toBe(0);
  });

  it('um evento CONNECTED repetido não conta o jogador duas vezes', () => {
    sessions.connected(event({}));
    sessions.connected(event({}));

    expect(sessions.count('srv-1')).toBe(1);
  });

  it('uma nova sessão do mesmo nick substitui a anterior, como o despejo do Gateway (RF-GW-13)', () => {
    sessions.connected(event({ session_id: 'velha' }));
    sessions.connected(event({ session_id: 'nova' }));

    expect(sessions.list('srv-1').map((s) => s.sessionId)).toEqual(['nova']);
    sessions.disconnected(event({ session_id: 'velha' }));
    expect(sessions.count('srv-1')).toBe(1);
  });

  it('DISCONNECTED de sessão desconhecida é ignorado', () => {
    sessions.disconnected(event({ session_id: 'nunca-vista' }));

    expect(sessions.count('srv-1')).toBe(0);
  });

  it('clearAll descarta tudo, para reconciliar quando o stream do Gateway cai', () => {
    sessions.connected(event({}));

    sessions.clearAll();

    expect(sessions.count('srv-1')).toBe(0);
  });

  describe('avisa o painel quando os jogadores de um servidor mudam', () => {
    let published: { id: string; kind: string }[];

    beforeEach(() => {
      const bus = new ServerActivityBus();
      published = [];
      bus.events$.subscribe((e) => published.push(e));
      sessions = new PlayerSessionsService(bus);
    });

    it('ao entrar e ao sair', () => {
      sessions.connected(event({ session_id: 's1' }));
      sessions.disconnected(event({ session_id: 's1' }));

      expect(published).toEqual([
        { id: 'srv-1', kind: 'players' },
        { id: 'srv-1', kind: 'players' },
      ]);
    });

    it('para cada servidor que perdeu as sessões quando o stream do Gateway cai', () => {
      sessions.connected(event({ session_id: 's1', server_id: 'srv-1' }));
      sessions.connected(event({ session_id: 's2', server_id: 'srv-2' }));
      published.length = 0;

      sessions.clearAll();

      expect(published.map((e) => e.id).sort()).toEqual(['srv-1', 'srv-2']);
    });
  });
});
