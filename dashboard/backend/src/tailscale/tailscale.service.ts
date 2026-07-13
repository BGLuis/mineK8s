import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../app-config/app-config.service';

export class CreateInviteDto {
	playerName: string;
	/** 'global' = todos os servidores | 'group' = grupo por tags | 'individual' = server(s) específico(s) */
	scope: 'global' | 'group' | 'individual';
	/** IDs dos servidores K8s (ex: ['mc-survival-abc']) — para scope group ou individual */
	serverIds?: string[];
	/** Dias até a chave expirar. Padrão: 7 */
	expiresInDays?: number;
}

export interface InviteResult {
	playerName: string;
	authKey: string;
	joinUrl: string;
	expiresAt: Date;
	tags: string[];
	scope: string;
}

@Injectable()
export class TailscaleService {
	private readonly logger = new Logger(TailscaleService.name);
	private readonly API_BASE = 'https://api.tailscale.com/api/v2';
	private readonly tailnet: string;
	private readonly apiToken: string;
	private readonly funnelHost: string;

	constructor(private readonly appConfig: AppConfigService) {
		this.tailnet = this.appConfig.tailscaleTailnet;
		this.apiToken = this.appConfig.tailscaleApiToken;
		this.funnelHost = this.appConfig.tailscaleFunnelHost;
	}

	// Cache: Mapeamento de IP (ex: "100.90.0.1") -> User ID / Email
	private deviceOwnerCache: Map<string, string> = new Map();
	private lastCacheUpdate = 0;

	// ---------------------------------------------------------------------------
	// Gera um convite (Pre-Auth Key) para um jogador
	// ---------------------------------------------------------------------------
	async createInvite(dto: CreateInviteDto): Promise<InviteResult> {
		if (!this.apiToken) {
			throw new HttpException(
				'TAILSCALE_API_TOKEN não configurado no ambiente.',
				HttpStatus.INTERNAL_SERVER_ERROR,
			);
		}

		const tags = this.resolveTagsForScope(dto);
		const expirySeconds = (dto.expiresInDays ?? 7) * 86_400;

		// (Opção B) Atualiza o ACL automaticamente para garantir que a tag exista
		await this.ensureTagsInACL(tags);

		this.logger.log(
			`Criando convite para "${dto.playerName}" com tags: ${tags.join(', ')}`,
		);

		const response = await fetch(
			`${this.API_BASE}/tailnet/${this.tailnet}/keys`,
			{
				method: 'POST',
				headers: {
					Authorization: `Bearer ${this.apiToken}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					capabilities: {
						devices: {
							create: {
								reusable: false, // chave de uso único — mais seguro
								ephemeral: false, // dispositivo persiste mesmo offline
								preauthorized: true, // entra na tailnet sem aprovação manual
								tags,
							},
						},
					},
					expirySeconds,
				}),
			},
		);

		if (!response.ok) {
			const err = await response.text();
			this.logger.error(`Tailscale API error: ${err}`);
			throw new HttpException(
				`Falha ao criar chave no Tailscale: ${err}`,
				HttpStatus.BAD_GATEWAY,
			);
		}

		const data = await response.json();
		const authKey: string = data.key; // formato: tskey-auth-xxxxxxxxxxxxxxxxxx-xxxxxxxx

		// Monta a URL pública da página /join (servida pelo join-server na porta 3001 via Funnel)
		// A chave vai no hash (#) para NÃO ser enviada ao servidor join nem aparecer em logs
		const baseUrl = this.funnelHost
			? `https://${this.funnelHost}`
			: `http://localhost:3001`;

		const joinUrl = `${baseUrl}/join#${authKey}`;

		return {
			playerName: dto.playerName,
			authKey,
			joinUrl,
			expiresAt: new Date(Date.now() + expirySeconds * 1000),
			tags,
			scope: dto.scope,
		};
	}

	// ---------------------------------------------------------------------------
	// Lista dispositivos conectados na tailnet com tag minecraft
	// ---------------------------------------------------------------------------
	async listMinecraftDevices(): Promise<{ tags?: string[] }[]> {
		if (!this.apiToken) return [];

		const res = await fetch(
			`${this.API_BASE}/tailnet/${this.tailnet}/devices`,
			{
				headers: { Authorization: `Bearer ${this.apiToken}` },
			},
		);

		if (!res.ok) return [];

		const data = await res.json();
		return (data.devices ?? []).filter((d: { tags?: string[] }) =>
			d.tags?.some(
				(t: string) =>
					t.startsWith('tag:minecraft') || t.startsWith('tag:mc-'),
			),
		);
	}

	// ---------------------------------------------------------------------------
	// Remove um dispositivo da tailnet (kick)
	// ---------------------------------------------------------------------------
	async revokeDevice(deviceId: string): Promise<void> {
		if (!this.apiToken) {
			throw new HttpException(
				'TAILSCALE_API_TOKEN não configurado.',
				HttpStatus.INTERNAL_SERVER_ERROR,
			);
		}

		const res = await fetch(`${this.API_BASE}/device/${deviceId}`, {
			method: 'DELETE',
			headers: { Authorization: `Bearer ${this.apiToken}` },
		});

		if (!res.ok) {
			throw new HttpException(
				'Falha ao revogar dispositivo no Tailscale.',
				HttpStatus.BAD_GATEWAY,
			);
		}
	}

	// ---------------------------------------------------------------------------
	// (Ponte de Identidade) Resolve a qual usuário pertence o IP 100.X
	// ---------------------------------------------------------------------------
	async getDeviceOwner(ip: string): Promise<string | null> {
		// 1. Tenta no cache rápido (para não causar lag no login do Minecraft)
		if (
			this.deviceOwnerCache.has(ip) &&
			Date.now() - this.lastCacheUpdate < 300_000
		) {
			// 5 minutos
			return this.deviceOwnerCache.get(ip) || null;
		}

		// 2. Se não tem no cache, busca a lista completa na API do Tailscale
		if (!this.apiToken) {
			this.logger.error(
				'TAILSCALE_API_TOKEN ausente. Não é possível mapear IPs.',
			);
			return null;
		}

		try {
			const res = await fetch(
				`${this.API_BASE}/tailnet/${this.tailnet}/devices`,
				{
					headers: { Authorization: `Bearer ${this.apiToken}` },
				},
			);

			if (!res.ok) {
				this.logger.error(
					`Falha ao buscar devices no Tailscale: ${await res.text()}`,
				);
				return null;
			}

			const data = await res.json();

			// Limpa e reconstrói o cache
			this.deviceOwnerCache.clear();
			this.lastCacheUpdate = Date.now();

			for (const device of data.devices || []) {
				const ownerId = device.user; // O "user" do Tailscale (ID do usuário ou e-mail dependendo da rede)
				for (const addr of device.addresses || []) {
					this.deviceOwnerCache.set(addr, ownerId);
				}
			}

			// Retorna a busca do cache renovado
			return this.deviceOwnerCache.get(ip) || null;
		} catch (err) {
			this.logger.error(
				`Erro ao atualizar cache do Tailscale: ${err.message}`,
			);
			return null;
		}
	}

	// ---------------------------------------------------------------------------
	// (Opção B) Verifica e atualiza dinamicamente as Tags no ACL
	// ---------------------------------------------------------------------------
	private async ensureTagsInACL(tagsToEnsure: string[]): Promise<void> {
		if (!this.apiToken) return;

		const requiredTags = tagsToEnsure.filter(
			(t) => t !== 'tag:minecraft-infra',
		);
		if (requiredTags.length === 0) return;

		this.logger.log(
			`Verificando ACL para as tags: ${requiredTags.join(', ')}`,
		);

		const getRes = await fetch(
			`${this.API_BASE}/tailnet/${this.tailnet}/acl`,
			{
				headers: {
					Authorization: `Bearer ${this.apiToken}`,
					Accept: 'application/json',
				},
			},
		);

		if (!getRes.ok) {
			this.logger.warn(
				`Não foi possível ler o ACL: ${await getRes.text()}`,
			);
			return;
		}

		const etag = getRes.headers.get('etag') || '';
		const acl = await getRes.json();
		let modified = false;

		if (!acl.tagOwners) acl.tagOwners = {};

		for (const tag of requiredTags) {
			if (!acl.tagOwners[tag]) {
				acl.tagOwners[tag] = ['autogroup:admin'];
				modified = true;
			}
		}

		if (modified) {
			this.logger.log(`Atualizando ACL do Tailscale com novas tags...`);
			const postRes = await fetch(
				`${this.API_BASE}/tailnet/${this.tailnet}/acl`,
				{
					method: 'POST',
					headers: {
						Authorization: `Bearer ${this.apiToken}`,
						'Content-Type': 'application/json',
						'If-Match': etag,
					},
					body: JSON.stringify(acl),
				},
			);

			if (!postRes.ok) {
				this.logger.error(
					`Falha ao atualizar ACL: ${await postRes.text()}`,
				);
				this.logger.warn(
					`Lembre-se: Para atualizar o ACL dinamicamente, o token deve ser um Personal Access Token com poderes de Admin.`,
				);
			} else {
				this.logger.log(`ACL atualizado dinamicamente com sucesso!`);
			}
		}
	}

	// ---------------------------------------------------------------------------
	// Resolve quais tags aplicar baseado no escopo do convite
	// ---------------------------------------------------------------------------
	private resolveTagsForScope(dto: CreateInviteDto): string[] {
		switch (dto.scope) {
			case 'global':
				// Acesso a todos os servidores Minecraft
				return ['tag:minecraft'];

			case 'group':
				// Acesso a um conjunto de servidores identificados pelos IDs
				return [
					'tag:minecraft',
					...(dto.serverIds ?? []).map((id) => `tag:group-${id}`),
				];

			case 'individual':
				// Acesso apenas aos servidores listados
				return (dto.serverIds ?? []).map((id) => `tag:${id}`);

			default:
				return ['tag:minecraft'];
		}
	}
}
