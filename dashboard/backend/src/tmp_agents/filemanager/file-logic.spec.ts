import { FileManagerAdvanced } from './file-logic';
import * as child_process from 'child_process';

jest.mock('child_process');

describe('FileManagerAdvanced', () => {
  let fileManager: FileManagerAdvanced;

  beforeEach(() => {
    fileManager = new FileManagerAdvanced();
  });

  it('should call kubectl exec to delete a file', async () => {
    const mockExec = child_process.exec as unknown as jest.Mock;
    mockExec.mockImplementation((cmd, cb) => cb(null, 'ok', ''));

    await fileManager.deleteFile('pod-123', '/data/ops.json');
    expect(mockExec).toHaveBeenCalledWith('kubectl exec pod-123 -- rm -f /data/ops.json', expect.any(Function));
  });
});
