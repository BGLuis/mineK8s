import { ApiProperty } from '@nestjs/swagger';

export enum SecurityPostureStatus {
  COMPLIANT = 'COMPLIANT',
  VULNERABLE = 'VULNERABLE',
  WARNING = 'WARNING',
  ERROR = 'ERROR',
}

export type FindingSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export class PostureFinding {
  @ApiProperty({ example: 'CRITICAL', enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] })
  severity: FindingSeverity;

  @ApiProperty({ example: 1, required: false })
  ruleIndex?: number;

  @ApiProperty({
    example: 'Regra permissiva detectada: tag:mc-player possui destino irrestrito (*:*)',
  })
  description: string;

  @ApiProperty({ required: false })
  rawRule?: unknown;
}

export class PolicyTestOutcome {
  @ApiProperty({ example: 'tag:mc-player' })
  src: string;

  @ApiProperty({ example: 'tag:mc-gateway:25565' })
  target: string;

  @ApiProperty({ example: 'accept' })
  expected: 'accept' | 'deny';

  @ApiProperty({ example: true })
  passed: boolean;

  @ApiProperty({ example: 'Regra autorizada conforme esperado', required: false })
  detail?: string;
}

export class PostureAuditReport {
  @ApiProperty({ enum: SecurityPostureStatus, example: SecurityPostureStatus.COMPLIANT })
  status: SecurityPostureStatus;

  @ApiProperty({ example: '2026-09-29T18:30:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: true })
  isTailnetLiveChecked: boolean;

  @ApiProperty({ example: 'cloud_api', enum: ['cloud_api', 'local_file', 'memory'] })
  policySource: 'cloud_api' | 'local_file' | 'memory';

  @ApiProperty({ type: [PostureFinding] })
  findings: PostureFinding[];

  @ApiProperty({
    example: {
      totalRules: 2,
      wildcardPlayerFound: false,
      onlyGamePortExposed: true,
      testsPassed: 7,
      testsFailed: 0,
    },
  })
  testedRulesSummary: {
    totalRules: number;
    wildcardPlayerFound: boolean;
    onlyGamePortExposed: boolean;
    testsPassed: number;
    testsFailed: number;
  };

  @ApiProperty({ type: [PolicyTestOutcome], required: false })
  policyTestsResults?: PolicyTestOutcome[];
}
