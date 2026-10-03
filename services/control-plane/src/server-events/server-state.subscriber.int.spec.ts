import 'reflect-metadata';
import { DataSource } from 'typeorm';

import * as entityModule from '../database/entities';
import { migrations } from '../database/migrations';
import { Server } from '../database/entities/server.entity';
import { ServerStateSubscriber } from './server-state.subscriber';

/**
 * Integração contra um Postgres real. Só roda com TEST_DATABASE_URL, por exemplo:
 *   docker run --rm -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=verify -p 55432:5432 postgres:16-alpine
 *   TEST_DATABASE_URL=postgres://postgres:pw@localhost:55432/verify npx jest server-state.subscriber.int
 * O banco é recriado a cada execução (dropSchema).
 */
const url = process.env.TEST_DATABASE_URL;
const describeWithDb = url ? describe : describe.skip;

describeWithDb('ServerStateSubscriber contra Postgres real', () => {
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
    const entities = Object.values(entityModule).filter((value) => typeof value === 'function') as any[];
    dataSource = new DataSource({ type: 'postgres', url, entities, migrations, dropSchema: true });
    await dataSource.initialize();
    await dataSource.runMigrations();
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  beforeEach(() => {
    emitted = [];
    dataSource.subscribers.length = 0;
    new ServerStateSubscriber(dataSource, { emitServerState: (event: any) => emitted.push(event) } as any);
  });

  it('aplica todas as migrations em um banco vazio, incluindo invites.created_by e servers.access_policy', async () => {
    const columns = await dataSource.query(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE (table_name = 'invites' AND column_name = 'created_by')
          OR (table_name = 'servers' AND column_name IN ('access_policy', 'restart_count', 'last_player_active_at'))`,
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
