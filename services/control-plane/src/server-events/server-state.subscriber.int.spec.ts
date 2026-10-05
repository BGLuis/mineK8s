import { DataSource } from 'typeorm';

import { Server } from '../database/entities/server.entity';
import {
  createIntegrationDataSource,
  describeWithDatabase,
} from '../database/testing/integration-datasource';
import { ServerStateSubscriber } from './server-state.subscriber';

describeWithDatabase('ServerStateSubscriber contra Postgres real', () => {
  let dataSource: DataSource;
  let emitted: Array<{ id: string; status: string; is_maintenance: boolean }>;

  const newServer = (subdomain: string) =>
    dataSource.getRepository(Server).create({
      name: subdomain,
      subdomain,
      server_type: 'PAPER',
      game_version: '1.20.4',
    });

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('int_server_state');
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  beforeEach(() => {
    emitted = [];
    dataSource.subscribers.length = 0;
    new ServerStateSubscriber(dataSource, {
      emitServerState: (event: any) => emitted.push(event),
    } as any);
  });

  it('aplica todas as migrations em um banco vazio, incluindo invites.created_by e servers.access_policy', async () => {
    const columns = await dataSource.query(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = current_schema()
         AND ((table_name = 'invites' AND column_name = 'created_by')
          OR (table_name = 'servers' AND column_name IN ('access_policy', 'restart_count', 'last_player_active_at')))`,
    );

    expect(columns).toHaveLength(4);
  });

  it('emite o estado inicial depois de gravar um servidor novo', async () => {
    const saved = await dataSource.getRepository(Server).save(newServer('inserido'));

    expect(emitted).toEqual([{ id: saved.id, status: 'STOPPED', is_maintenance: false }]);
  });

  it('emite quando o estado muda e não emite quando só outro campo muda', async () => {
    const repo = dataSource.getRepository(Server);
    const server = await repo.save(newServer('transicao'));
    emitted.length = 0;

    server.name = 'renomeado';
    await repo.save(server);
    expect(emitted).toEqual([]);

    server.state = 'STARTING';
    await repo.save(server);
    server.state = 'READY';
    await repo.save(server);

    expect(emitted.map((event) => event.status)).toEqual(['STARTING', 'READY']);
    expect(emitted.every((event) => event.id === server.id)).toBe(true);
  });

  it('emite is_maintenance junto com o estado', async () => {
    const repo = dataSource.getRepository(Server);
    const server = await repo.save(newServer('manutencao'));
    emitted.length = 0;

    server.is_maintenance = true;
    await repo.save(server);

    expect(emitted).toEqual([{ id: server.id, status: 'STOPPED', is_maintenance: true }]);
  });

  it('só emite depois do COMMIT: dentro da transação ainda não, e nada em caso de rollback', async () => {
    const repo = dataSource.getRepository(Server);
    const server = await repo.save(newServer('commit'));
    emitted.length = 0;

    await dataSource.transaction(async (manager) => {
      server.state = 'READY';
      await manager.save(server);
      expect(emitted).toEqual([]);
    });
    expect(emitted.map((event) => event.status)).toEqual(['READY']);

    emitted.length = 0;
    await expect(
      dataSource.transaction(async (manager) => {
        server.state = 'CRASHED';
        await manager.save(server);
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(emitted).toEqual([]);
  });
});
