import { classifyDiskUsage } from './disk-thresholds';

describe('classifyDiskUsage (SRS 05 §1.1)', () => {
  it.each([
    [74, null, false],
    [75, 'warning', false],
    [84.9, 'warning', false],
    [85, 'warning', true],
    [89, 'warning', true],
    [90, 'danger', true],
    [100, 'danger', true],
  ])('%s %% -> alert %s, blocksCreation %s', (percent, alert, blocksCreation) => {
    expect(classifyDiskUsage(percent)).toEqual({ alert, blocksCreation });
  });
});
