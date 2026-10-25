import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CONSOLE_DRIVER_TOKEN, ConsoleDriver } from '@console/console-driver.interface';
import { Server } from '@database/entities/server.entity';
import { MINECRAFT_NICK_REGEX } from '@tailscale/decision/nickname-validator';

import { LagDimension, LagPlayer, LagSnapshotDto } from './dto/lag-snapshot.dto';
import { lagFindings, NEARBY_RADIUS } from './lag-findings';
import {
  parseConditionalCount,
  parseDimension,
  parseDimensionTickTimes,
  parsePaperEntityList,
  parsePosition,
} from './lag-output';

const RCON_TIMEOUT_MS = 5000;
const VANILLA_DIMENSIONS = ['minecraft:overworld', 'minecraft:the_nether', 'minecraft:the_end'];
/** Dimension ids read back from the server go into commands, so only plain resource locations pass. */
const DIMENSION_ID = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/;
const TOP_ENTITY_TYPES = 5;

/**
 * Takes a one-off picture of where the load is: entities per dimension and around each player,
 * plus what the server type adds (entity types on Paper, tick time per dimension on Forge/NeoForge).
 * Every command is optional; one that fails leaves its field null instead of failing the snapshot.
 */
@Injectable()
export class LagSnapshotService {
  constructor(
    @InjectRepository(Server)
    private readonly serverRepo: Repository<Server>,
    @Inject(CONSOLE_DRIVER_TOKEN)
    private readonly console: ConsoleDriver,
  ) {}

  async take(id: string): Promise<LagSnapshotDto> {
    const server = await this.serverRepo.findOne({ where: { id } });
    if (!server) {
      throw new NotFoundException(`Server with ID "${id}" not found`);
    }
    if (server.state !== 'READY') {
      throw new ConflictException('The server must be READY to take a lag snapshot');
    }

    const nicks = (await this.console.listPlayers(server)).filter((nick) =>
      MINECRAFT_NICK_REGEX.test(nick),
    );
    const players = await Promise.all(nicks.map((nick) => this.readPlayer(server, nick)));

    const dimensionIds = [
      ...new Set([
        ...VANILLA_DIMENSIONS,
        ...players.flatMap((p) =>
          p.dimension && DIMENSION_ID.test(p.dimension) ? [p.dimension] : [],
        ),
      ]),
    ];
    const tickTimes = await this.readTickTimes(server);
    const dimensions = await Promise.all(
      dimensionIds.map((dimension) => this.readDimension(server, dimension, players, tickTimes)),
    );

    return {
      takenAt: new Date().toISOString(),
      radius: NEARBY_RADIUS,
      dimensions,
      players,
      findings: lagFindings(dimensions, players),
    };
  }

  private async readPlayer(server: Server, nick: string): Promise<LagPlayer> {
    const around = `execute at ${nick} if entity`;
    const [dimension, position, nearbyEntities, nearbyItems] = await Promise.all([
      this.run(server, `data get entity ${nick} Dimension`, parseDimension),
      this.run(server, `data get entity ${nick} Pos`, parsePosition),
      this.run(
        server,
        `${around} @e[type=!player,distance=..${NEARBY_RADIUS}]`,
        parseConditionalCount,
      ),
      this.run(
        server,
        `${around} @e[type=item,distance=..${NEARBY_RADIUS}]`,
        parseConditionalCount,
      ),
    ]);
    return { nick, dimension, position, nearbyEntities, nearbyItems };
  }

  private async readDimension(
    server: Server,
    id: string,
    players: LagPlayer[],
    tickTimes: Map<string, number> | null,
  ): Promise<LagDimension> {
    // `distance` keeps the selector in the dimension `execute in` moved to; without it @e spans all of them.
    const inside = `execute in ${id} if entity`;
    const [entities, items, topEntities] = await Promise.all([
      this.run(server, `${inside} @e[type=!player,distance=0..]`, parseConditionalCount),
      this.run(server, `${inside} @e[type=item,distance=0..]`, parseConditionalCount),
      this.isPaperLike(server)
        ? this.run(server, `paper entity list * ${id}`, parsePaperEntityList)
        : Promise.resolve(null),
    ]);
    return {
      id,
      players: players.filter((p) => p.dimension === id).map((p) => p.nick),
      entities,
      items,
      meanTickMs: tickTimes?.get(id) ?? null,
      topEntities: (topEntities ?? []).slice(0, TOP_ENTITY_TYPES),
    };
  }

  /** NeoForge answers `neoforge tps`; builds still close to the Forge fork may only know `forge tps`. */
  private async readTickTimes(server: Server): Promise<Map<string, number> | null> {
    const type = server.server_type.toUpperCase();
    if (type === 'NEOFORGE') {
      return (
        (await this.run(server, 'neoforge tps', parseDimensionTickTimes)) ??
        this.run(server, 'forge tps', parseDimensionTickTimes)
      );
    }
    return type === 'FORGE' ? this.run(server, 'forge tps', parseDimensionTickTimes) : null;
  }

  private isPaperLike(server: Server): boolean {
    return ['PAPER', 'PURPUR'].includes(server.server_type.toUpperCase());
  }

  private async run<T>(
    server: Server,
    command: string,
    parse: (output: string) => T | null,
  ): Promise<T | null> {
    try {
      return parse(await this.console.sendCommand(server, command, { timeoutMs: RCON_TIMEOUT_MS }));
    } catch {
      return null;
    }
  }
}
