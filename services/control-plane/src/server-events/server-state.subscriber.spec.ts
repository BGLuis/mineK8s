import { ServerStateSubscriber } from './server-state.subscriber';

describe('ServerStateSubscriber', () => {
  let gateway: { emitServerState: jest.Mock };
  let subscriber: ServerStateSubscriber;
  let dataSource: { subscribers: unknown[] };

  const column = (propertyName: string) => ({ propertyName });
  const transaction = (active = true): any => ({ isTransactionActive: active });

  beforeEach(() => {
    gateway = { emitServerState: jest.fn() };
    dataSource = { subscribers: [] };
    subscriber = new ServerStateSubscriber(dataSource as any, gateway as any);
  });

  it('registra a si mesmo no DataSource para escutar a entidade Server', () => {
    expect(dataSource.subscribers).toContain(subscriber);
  });

  it('segura o evento até o COMMIT e descarta no ROLLBACK', () => {
    const queryRunner = transaction();
    subscriber.afterUpdate({
      queryRunner,
      updatedColumns: [column('state')],
      entity: { id: 'srv-1', state: 'READY', is_maintenance: false },
      databaseEntity: { id: 'srv-1', state: 'STARTING' },
    } as any);
    expect(gateway.emitServerState).not.toHaveBeenCalled();

    subscriber.afterTransactionCommit({ queryRunner } as any);
    expect(gateway.emitServerState).toHaveBeenCalledWith({ id: 'srv-1', status: 'READY', is_maintenance: false });

    gateway.emitServerState.mockClear();
    const rolledBack = transaction();
    subscriber.afterUpdate({
      queryRunner: rolledBack,
      updatedColumns: [column('state')],
      entity: { id: 'srv-1', state: 'CRASHED' },
      databaseEntity: { id: 'srv-1' },
    } as any);
    subscriber.afterTransactionRollback({ queryRunner: rolledBack } as any);
    subscriber.afterTransactionCommit({ queryRunner: rolledBack } as any);
    expect(gateway.emitServerState).not.toHaveBeenCalled();
  });

  it('ignora atualizações que não mexem em estado nem manutenção', () => {
    subscriber.afterUpdate({
      queryRunner: transaction(false),
      updatedColumns: [column('name'), column('updated_at')],
      entity: { id: 'srv-1', state: 'READY' },
      databaseEntity: { id: 'srv-1' },
    } as any);

    expect(gateway.emitServerState).not.toHaveBeenCalled();
  });

  it('emite na hora quando não há transação aberta', () => {
    subscriber.afterUpdate({
      queryRunner: transaction(false),
      updatedColumns: [column('is_maintenance')],
      entity: { id: 'srv-1', state: 'READY', is_maintenance: true },
      databaseEntity: { id: 'srv-1' },
    } as any);

    expect(gateway.emitServerState).toHaveBeenCalledWith({ id: 'srv-1', status: 'READY', is_maintenance: true });
  });
});
