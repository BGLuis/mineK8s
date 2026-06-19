import { BackupsService } from './backups.service';
import * as k8s from '@kubernetes/client-node';

jest.mock('@kubernetes/client-node');

describe('BackupsService', () => {
  let service: BackupsService;
  let mockCreateNamespacedJob: jest.Mock;

  beforeEach(() => {
    mockCreateNamespacedJob = jest.fn().mockResolvedValue({});
    (k8s.KubeConfig as jest.Mock).mockImplementation(() => ({
      loadFromDefault: jest.fn(),
      makeApiClient: jest.fn().mockReturnValue({
        createNamespacedJob: mockCreateNamespacedJob
      })
    }));
    service = new BackupsService();
  });

  it('should create a backup job correctly mounting PVCs', async () => {
    await service.createBackupJob('atm10-server');
    
    expect(mockCreateNamespacedJob).toHaveBeenCalledTimes(1);
    const jobSpec = mockCreateNamespacedJob.mock.calls[0][1];
    expect(jobSpec.metadata.name).toContain('backup-atm10-server');
    expect(jobSpec.spec.template.spec.volumes).toEqual([
      { name: 'data-volume', persistentVolumeClaim: { claimName: 'atm10-server-pvc' } },
      { name: 'backup-volume', persistentVolumeClaim: { claimName: 'global-backups-pvc' } }
    ]);
  });
});
