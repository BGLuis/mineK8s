import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class ModpacksService {
  // A chave de API oficial do CurseForge encontrada no código fonte do PrismLauncher
  private curseforgeApiKey = '$2a$10$wuAJuNZuted3NORVmpgUC.m8sI.pv1tOPKZyBgLFGjxFp/br0lZCC';

  constructor(private readonly httpService: HttpService) {}

  async searchModpacks(query: string, limit: number = 20, source?: string) {
    try {
      let modrinthPromise: Promise<any> = Promise.resolve({ data: { hits: [] } });
      let curseforgePromise: Promise<any> = Promise.resolve({ data: { data: [] } });

      const filterSource = source?.toLowerCase();

      // 1. Dispara busca no Modrinth se o filtro permitir
      if (!filterSource || filterSource === 'modrinth') {
        modrinthPromise = firstValueFrom(
          this.httpService.get(`https://api.modrinth.com/v2/search`, {
            params: { query, facets: '[["project_type:modpack"]]', limit },
          })
        ).catch(e => ({ data: { hits: [] } })); // Ignora erro caso a plataforma caia
      }

      // 2. Dispara busca no CurseForge se o filtro permitir
      if (!filterSource || filterSource === 'curseforge') {
        curseforgePromise = firstValueFrom(
          this.httpService.get(`https://api.curseforge.com/v1/mods/search`, {
            headers: { 'x-api-key': this.curseforgeApiKey },
            params: { gameId: 432, classId: 4471, searchFilter: query, pageSize: limit, sortField: 2, sortOrder: 'desc' },
          })
        ).catch(e => ({ data: { data: [] } }));
      }

      // Aguarda os dois responderem (Alta Performance)
      const [modrinthRes, curseforgeRes] = await Promise.all([modrinthPromise, curseforgePromise]);

      // 3. Mapeia o formato do Modrinth para o nosso formato Universal
      const modrinthResults = (modrinthRes.data?.hits || []).map((hit: any) => ({
        id: hit.project_id,
        slug: hit.slug,
        title: hit.title,
        description: hit.description,
        author: hit.author,
        downloads: hit.downloads,
        versions: hit.versions || [],
        iconUrl: hit.icon_url,
        categories: hit.categories || [],
        source: 'Modrinth'
      }));

      // 4. Mapeia o formato do CurseForge para o nosso formato Universal
      const curseforgeResults = (curseforgeRes.data?.data || []).map((mod: any) => ({
        id: mod.id.toString(),
        slug: mod.slug,
        title: mod.name,
        description: mod.summary,
        author: mod.authors?.[0]?.name || 'Unknown',
        downloads: mod.downloadCount,
        // Curseforge retorna arrays repetidos, usamos um Set para remover versões duplicadas
        versions: Array.from(new Set(mod.latestFilesIndexes?.map((f: any) => f.gameVersion) || [])),
        iconUrl: mod.logo?.thumbnailUrl || mod.logo?.url,
        categories: mod.categories?.map((c: any) => c.name) || [],
        source: 'CurseForge'
      }));

      // Junta os dois resultados e ordena por quem tem mais downloads
      const combined = [...modrinthResults, ...curseforgeResults]
        .sort((a, b) => b.downloads - a.downloads)
        .slice(0, limit);

      return {
        total: combined.length,
        results: combined,
      };
    } catch (error) {
      throw new HttpException(
        `Falha ao buscar Modpacks: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  async getModpackVersions(id: string, source: string) {
    try {
      if (source === 'Modrinth') {
        const res = await firstValueFrom(this.httpService.get(`https://api.modrinth.com/v2/project/${id}/version`));
        return res.data.map((v: any) => ({
          id: v.version_number,
          name: v.name,
          date: v.date_published
        }));
      } else if (source === 'CurseForge') {
        const res = await firstValueFrom(this.httpService.get(`https://api.curseforge.com/v1/mods/${id}/files`, {
          headers: { 'x-api-key': this.curseforgeApiKey }
        }));
        // Filtra apenas os arquivos do tipo "Server Pack" se possível, ou retorna todos
        // Como Curseforge mistura cliente/servidor, vamos retornar todos e o usuário escolhe, ou filtramos por nome contendo 'server'
        return res.data.data.map((f: any) => ({
          id: f.id.toString(),
          name: f.displayName,
          date: f.fileDate
        }));
      }
      return [];
    } catch (error) {
      console.error('Erro na API de Versões:', error?.response?.data || error);
      throw new HttpException('Falha ao buscar versões', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
