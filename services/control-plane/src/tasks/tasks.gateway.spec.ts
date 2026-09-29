import { TasksGateway } from './tasks.gateway';

describe('TasksGateway (RF-STO-18)', () => {
  let gateway: TasksGateway;
  let mockServer: any;

  beforeEach(() => {
    gateway = new TasksGateway();
    mockServer = {
      to: jest.fn().mockReturnThis(),
      emit: jest.fn(),
    };
    gateway.server = mockServer;
  });

  it('deve inscrever o cliente na sala correspondente à task', () => {
    const mockClient = {
      id: 'client-1',
      join: jest.fn(),
    };

    const res = gateway.handleSubscribeToTask(mockClient, { taskId: 'task-uuid-1' });

    expect(mockClient.join).toHaveBeenCalledWith('task:task-uuid-1');
    expect(res).toEqual({ status: 'subscribed', taskId: 'task-uuid-1' });
  });

  it('deve emitir evento taskProgress para a sala da task', () => {
    const payload = {
      taskId: 'task-uuid-1',
      serverId: 'srv-1',
      status: 'DOWNLOADING',
      progressPercent: 50,
      downloadedFiles: 25,
      totalFiles: 50,
      currentStep: 'Baixando mod lithium.jar (via Cache CAS)',
    };

    gateway.emitTaskProgress(payload);

    expect(mockServer.to).toHaveBeenCalledWith('task:task-uuid-1');
    expect(mockServer.emit).toHaveBeenCalledWith('taskProgress', payload);
  });
});
