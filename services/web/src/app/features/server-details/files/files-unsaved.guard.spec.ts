import { describe, expect, it, vi } from 'vitest';
import { canDeactivateFiles } from './files-unsaved.guard';
import { ServerFilesPage } from './server-files.page';

describe('canDeactivateFiles', () => {
  it('delegates directly to component.canDeactivate()', async () => {
    const mockComponent = {
      canDeactivate: vi.fn().mockResolvedValue(true),
    } as unknown as ServerFilesPage;

    const result = await canDeactivateFiles(mockComponent, {} as any, {} as any, {} as any);

    expect(result).toBe(true);
    expect(mockComponent.canDeactivate).toHaveBeenCalled();
  });
});
