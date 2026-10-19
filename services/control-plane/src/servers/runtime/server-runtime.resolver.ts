import { createHash } from 'node:crypto';
import { BadGatewayException, BadRequestException, Injectable } from '@nestjs/common';

import { AppConfigService } from '@config/app-config.service';
import { Server } from '@database/entities/server.entity';

/** What a server needs to boot, resolved once from the upstream APIs and stored on the server record. */
export type ServerRuntime = Pick<
  Server,
  | 'java_version'
  | 'server_jar_url'
  | 'server_jar_checksum'
  | 'server_build'
  | 'server_build_channel'
>;

const MC_VERSION_PATTERN =
  /^(?:\d+(\.\d+)+(-[a-zA-Z0-9._-]+)?|\d{2}w\d{2}[a-z](-[a-zA-Z0-9._-]+)?)$/;
/** Their installer provides the jar; only the Java version is resolved here. */
const MODPACK_LOADER_TYPES = ['FORGE', 'NEOFORGE', 'FABRIC'];
/** Java majors with an eclipse-temurin JRE image. There is no 16, and 17 runs what asks for 16. */
const RUNNER_JAVA_VERSIONS = [8, 11, 17, 21, 25];
// Fill v3 refuses requests without an identifying User-Agent.
const USER_AGENT = 'minek8s-control-plane/1.0 (https://github.com/BGLuis/mineK8s)';
const REQUEST_TIMEOUT_MS = 15_000;

interface MojangManifest {
  versions: { id: string; url: string; sha1: string }[];
}

interface MojangVersion {
  downloads?: { server?: { url: string; sha1: string } };
  javaVersion?: { majorVersion: number };
}

interface PaperVersion {
  version: { java: { version: { minimum: number } } };
}

interface PaperBuild {
  id: number;
  channel: string;
  downloads: Record<string, { url: string; checksums: { sha256: string } }>;
}

interface PurpurBuild {
  build: string;
  result: string;
  md5: string;
}

@Injectable()
export class ServerRuntimeResolver {
  constructor(private readonly configService: AppConfigService) {}

  async resolve(serverType: string, gameVersion: string): Promise<ServerRuntime> {
    if (!MC_VERSION_PATTERN.test(gameVersion)) {
      throw new BadRequestException(`Invalid Minecraft version "${gameVersion}"`);
    }

    const type = serverType.toUpperCase();
    if (type === 'VANILLA') return this.resolveVanilla(gameVersion);
    if (type === 'PAPER') return this.resolvePaper(gameVersion);
    if (type === 'PURPUR') return this.resolvePurpur(gameVersion);
    if (MODPACK_LOADER_TYPES.includes(type)) {
      const mojang = await this.mojangVersion(gameVersion);
      return {
        java_version: this.runnerJava(gameVersion, mojang.javaVersion?.majorVersion),
        server_jar_url: null,
        server_jar_checksum: null,
        server_build: null,
        server_build_channel: null,
      };
    }
    throw new BadRequestException(`Unknown server type "${serverType}"`);
  }

  private async resolveVanilla(version: string): Promise<ServerRuntime> {
    const mojang = await this.mojangVersion(version);
    const jar = mojang.downloads?.server;
    if (!jar?.url || !jar.sha1) {
      throw new BadRequestException(`Minecraft ${version} has no dedicated server jar`);
    }
    return {
      java_version: this.runnerJava(version, mojang.javaVersion?.majorVersion),
      server_jar_url: jar.url,
      server_jar_checksum: `sha1:${jar.sha1}`,
      server_build: null,
      server_build_channel: null,
    };
  }

  /** builds/latest would hand out ALPHA and BETA builds too, so the newest STABLE one is picked from the full list. */
  private async resolvePaper(version: string): Promise<ServerRuntime> {
    const base = `${this.configService.serverJarSources.paperApiUrl}/v3/projects/paper/versions/${version}`;
    const [meta, builds] = await Promise.all([
      this.getJson<PaperVersion>(base),
      this.getJson<PaperBuild[]>(`${base}/builds`),
    ]);
    if (!meta || !builds) {
      throw new BadRequestException(`Paper has no builds for Minecraft ${version}`);
    }

    const stable = builds
      .filter((build) => build.channel === 'STABLE')
      .reduce<PaperBuild | undefined>(
        (newest, build) => (newest && newest.id > build.id ? newest : build),
        undefined,
      );
    if (!stable) {
      throw new BadRequestException(
        `Paper has no STABLE build for Minecraft ${version} yet, only experimental (ALPHA/BETA) ones`,
      );
    }
    const jar = stable.downloads['server:default'];
    if (!jar?.url || !jar.checksums?.sha256) {
      throw new BadGatewayException(
        `Paper build ${stable.id} for ${version} has no server download`,
      );
    }

    return {
      java_version: this.runnerJava(version, meta.version.java.version.minimum),
      server_jar_url: jar.url,
      server_jar_checksum: `sha256:${jar.checksums.sha256}`,
      server_build: String(stable.id),
      server_build_channel: stable.channel,
    };
  }

  /** The Purpur API does not say which Java a build needs, so that comes from Mojang. */
  private async resolvePurpur(version: string): Promise<ServerRuntime> {
    const base = `${this.configService.serverJarSources.purpurApiUrl}/v2/purpur/${version}`;
    const [latest, mojang] = await Promise.all([
      this.getJson<PurpurBuild>(`${base}/latest`),
      this.mojangVersion(version),
    ]);
    if (!latest) {
      throw new BadRequestException(`Purpur has no builds for Minecraft ${version}`);
    }
    if (latest.result !== 'SUCCESS' || !latest.md5) {
      throw new BadRequestException(`Purpur has no successful build for Minecraft ${version}`);
    }

    return {
      java_version: this.runnerJava(version, mojang.javaVersion?.majorVersion),
      server_jar_url: `${base}/${latest.build}/download`,
      server_jar_checksum: `md5:${latest.md5}`,
      server_build: latest.build,
      server_build_channel: null,
    };
  }

  /** The v2 manifest carries the sha1 of each version document, so the document is checked before it is trusted. */
  private async mojangVersion(version: string): Promise<MojangVersion> {
    const manifest = await this.getJson<MojangManifest>(
      this.configService.serverJarSources.mojangManifestUrl,
    );
    const entry = manifest?.versions.find((v) => v.id === version);
    if (!entry) {
      throw new BadRequestException(`Minecraft ${version} is not a version published by Mojang`);
    }

    const body = await this.fetchText(entry.url);
    if (body === null || createHash('sha1').update(body).digest('hex') !== entry.sha1) {
      throw new BadGatewayException(`Mojang metadata for ${version} does not match its manifest`);
    }
    return JSON.parse(body) as MojangVersion;
  }

  private runnerJava(version: string, minimum: number | undefined): number {
    if (!minimum) {
      throw new BadGatewayException(`No Java version is published for Minecraft ${version}`);
    }
    const java = RUNNER_JAVA_VERSIONS.find((available) => available >= minimum);
    if (java === undefined) {
      throw new BadRequestException(
        `Minecraft ${version} needs Java ${minimum}, and the newest runner image has Java ${RUNNER_JAVA_VERSIONS.at(-1)}`,
      );
    }
    return java;
  }

  private async getJson<T>(url: string): Promise<T | null> {
    const body = await this.fetchText(url);
    return body === null ? null : (JSON.parse(body) as T);
  }

  /** null for a 404, which the APIs answer for a version they do not have. */
  private async fetchText(url: string): Promise<string | null> {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw new BadGatewayException(
        `Could not reach ${new URL(url).host}: ${(err as Error).message}`,
      );
    }
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new BadGatewayException(`${new URL(url).host} answered HTTP ${res.status}`);
    }
    return res.text();
  }
}
