import { EntityTypeCount, Position } from '../lag-output';

export interface LagDimension {
  id: string;
  players: string[];
  /** Loaded entities other than players; null when the server did not answer. */
  entities: number | null;
  items: number | null;
  /** Only Forge and NeoForge time each dimension. */
  meanTickMs: number | null;
  /** Only Paper and Purpur list entities per type. */
  topEntities: EntityTypeCount[];
}

export interface LagPlayer {
  nick: string;
  dimension: string | null;
  position: Position | null;
  nearbyEntities: number | null;
  nearbyItems: number | null;
}

export interface LagFinding {
  severity: 'warning' | 'info';
  message: string;
}

export interface LagSnapshotDto {
  takenAt: string;
  radius: number;
  dimensions: LagDimension[];
  players: LagPlayer[];
  findings: LagFinding[];
}
