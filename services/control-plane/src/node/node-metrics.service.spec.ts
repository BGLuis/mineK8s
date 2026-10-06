import os from 'node:os';
import { promises as fsPromises } from 'node:fs';
import { HttpException } from '@nestjs/common';

import { NodeMetricsService } from './node-metrics.service';

const GIB = 1024 ** 3;

function statfsFor(usedPercent: number) {
  const blocks = 1000;
  const bsize = GIB / 10;
  const free = Math.round(blocks * (1 - usedPercent / 100));
  return { blocks, bsize, bfree: free, bavail: free } as any;
}

function cpuSample(busy: number, idle: number) {
  return [{ times: { user: busy, nice: 0, sys: 0, idle, irq: 0 } }] as any;
}

describe('NodeMetricsService (#95)', () => {
  let deviceRepo: { count: jest.Mock };
  let serverRepo: { find: jest.Mock };
  let service: NodeMetricsService;

  const build = () =>
    new NodeMetricsService(
      { storage: { serversDataRoot: '/srv/servers' }, tailscale: { deviceLimit: 50 } } as any,
      serverRepo as any,
      deviceRepo as any,
    );

  beforeEach(() => {
    deviceRepo = { count: jest.fn().mockResolvedValue(12) };
    serverRepo = { find: jest.fn().mockResolvedValue([]) };
    jest.spyOn(os, 'totalmem').mockReturnValue(32 * GIB);
    jest.spyOn(os, 'cpus').mockReturnValue(cpuSample(0, 0));
    jest.spyOn(fsPromises, 'statfs').mockResolvedValue(statfsFor(50));
    service = build();
  });

  afterEach(() => jest.restoreAllMocks());

  describe('disk', () => {
    it.each([
      [74, null, false],
      [75, 'warning', false],
      [89, 'warning', true],
      [90, 'danger', true],
    ])('at %s %% reports alert %s and blocksCreation %s', async (percent, alert, blocks) => {
      jest.spyOn(fsPromises, 'statfs').mockResolvedValue(statfsFor(percent));

      const { disk } = await service.getMetrics();

      expect(disk).toMatchObject({ usedPercent: percent, alert, blocksCreation: blocks });
      expect(fsPromises.statfs).toHaveBeenCalledWith('/srv/servers');
    });

    it('reports capacity and free space in bytes', async () => {
      const { disk } = await service.getMetrics();

      expect(disk.total).toBe(100 * GIB);
      expect(disk.free).toBe(50 * GIB);
    });

    it('counts blocks reserved for root as used, like the space a server can actually grow into', async () => {
      jest
        .spyOn(fsPromises, 'statfs')
        .mockResolvedValue({ blocks: 1000, bsize: 1, bfree: 200, bavail: 100 } as any);

      const { disk } = await service.getMetrics();

      expect(disk.usedPercent).toBe(90);
    });
  });

  describe('assertDiskAllowsCreation', () => {
    it('refuses with a stable code once the disk reaches 85 %', async () => {
      jest.spyOn(fsPromises, 'statfs').mockResolvedValue(statfsFor(85));

      const error = await service.assertDiskAllowsCreation().catch((e) => e);

      expect(error).toBeInstanceOf(HttpException);
      expect(error.getStatus()).toBe(507);
      expect(error.getResponse()).toMatchObject({ code: 'DISK_USAGE_BLOCKED' });
    });

    it('allows creation at 84 %', async () => {
      jest.spyOn(fsPromises, 'statfs').mockResolvedValue(statfsFor(84));

      await expect(service.assertDiskAllowsCreation()).resolves.toBeUndefined();
    });

    it('does not block creation when the disk cannot be read: a broken probe is not a full disk', async () => {
      jest.spyOn(fsPromises, 'statfs').mockRejectedValue(new Error('ENOENT'));

      await expect(service.assertDiskAllowsCreation()).resolves.toBeUndefined();
    });
  });

  describe('memory', () => {
    it('allocates only the heap of servers that hold RAM, not stopped or failed ones', async () => {
      serverRepo.find.mockResolvedValue([
        { state: 'READY', allocated_memory_mb: 4096 },
        { state: 'STARTING', allocated_memory_mb: 2048 },
        { state: 'STOPPED', allocated_memory_mb: 8192 },
        { state: 'FAILED', allocated_memory_mb: 8192 },
        { state: 'CRASHED', allocated_memory_mb: 8192 },
      ]);

      const { memory } = await service.getMetrics();

      expect(memory).toEqual({ total: 32 * GIB, allocated: 6144 * 1024 * 1024 });
    });
  });

  describe('tailnet', () => {
    it('counts only ACTIVE devices against the configured limit', async () => {
      const { tailnet } = await service.getMetrics();

      expect(tailnet).toEqual({ active: 12, limit: 50 });
      expect(deviceRepo.count).toHaveBeenCalledWith({ where: { status: 'ACTIVE' } });
    });
  });

  describe('cpu', () => {
    it('measures usage between two samples, not the average since boot', async () => {
      const cpus = jest.spyOn(os, 'cpus').mockReturnValue(cpuSample(1000, 1000));
      jest.spyOn(Date, 'now').mockReturnValue(0);
      service = build();

      cpus.mockReturnValue(cpuSample(1075, 1025));
      jest.spyOn(Date, 'now').mockReturnValue(5000);
      const { cpu } = await service.getMetrics();

      expect(cpu).toEqual({ usedPercent: 75, cores: 1 });
    });
  });
});
