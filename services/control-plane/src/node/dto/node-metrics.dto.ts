import { ApiProperty } from '@nestjs/swagger';

import type { DiskAlertLevel } from '../disk-thresholds';

export class CpuMetricsDto {
  @ApiProperty({ description: 'Host CPU usage since the previous sample, 0-100' })
  usedPercent: number;

  @ApiProperty()
  cores: number;
}

export class MemoryMetricsDto {
  @ApiProperty({ description: 'Host RAM in bytes' })
  total: number;

  @ApiProperty({ description: 'Heap promised to servers that are running or starting, in bytes' })
  allocated: number;
}

export class DiskMetricsDto {
  @ApiProperty({ description: 'Servers volume capacity in bytes' })
  total: number;

  @ApiProperty({ description: 'Bytes still available' })
  free: number;

  @ApiProperty({ description: '0-100, one decimal; the thresholds apply to this value' })
  usedPercent: number;

  @ApiProperty({ enum: ['warning', 'danger'], nullable: true })
  alert: DiskAlertLevel | null;

  @ApiProperty({ description: 'True when creating servers is refused (SRS 05: 85 %)' })
  blocksCreation: boolean;
}

export class TailnetMetricsDto {
  @ApiProperty({ description: 'Devices with status ACTIVE' })
  active: number;

  @ApiProperty()
  limit: number;
}

export class NodeMetricsDto {
  @ApiProperty({ type: CpuMetricsDto })
  cpu: CpuMetricsDto;

  @ApiProperty({ type: MemoryMetricsDto })
  memory: MemoryMetricsDto;

  @ApiProperty({ type: DiskMetricsDto })
  disk: DiskMetricsDto;

  @ApiProperty({ type: TailnetMetricsDto })
  tailnet: TailnetMetricsDto;
}
