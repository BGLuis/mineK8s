import * as k8s from '@kubernetes/client-node';
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ServersService } from '../servers/servers.service';

/** Label K8s usada para configurar o modo de hibernação por servidor */
const HIBERNATE_LABEL = 'minekube/hibernate-after-minutes';

export interface SleepModeStatus {
	serverId: string;
	mode: 'always-on' | 'hibernate';
	hibernateAfterMinutes: number | null;
	inactiveSinceMinutes: number | null; // null = tem jogadores ativos
	willHibernateInMinutes: number | null; // null = Always On ou tem jogadores
}

@Injectable()
export class SleepModeService {
	private readonly logger = new Logger(SleepModeService.name);
	private k8sAppsApi: k8s.AppsV1Api;
	private readonly namespace = 'default';

	/**
	 * Rastreia desde quando cada servidor está com 0 jogadores.
	 * serverId → timestamp da primeira checagem com 0 jogadores
	 */
	private readonly inactiveSince = new Map<string, Date>();

	constructor(private readonly serversService: ServersService) {
		const kc = new k8s.KubeConfig();
		kc.loadFromDefault();
		this.k8sAppsApi = kc.makeApiClient(k8s.AppsV1Api);
	}

	// ---------------------------------------------------------------------------
	// Worker principal — roda a cada 5 minutos
	// ---------------------------------------------------------------------------
	@Cron(CronExpression.EVERY_5_MINUTES)
	async checkAndHibernate(): Promise<void> {
		this.logger.debug('Sleep Mode: verificando servidores ativos...');

		let onlineServers: k8s.V1Deployment[];
		try {
			const res = await this.k8sAppsApi.listNamespacedDeployment({
				namespace: this.namespace,
			});
			// Apenas deployments mc-* que estão rodando (replicas > 0)
			onlineServers = res.items.filter(
				(d) =>
					d.metadata?.name?.startsWith('mc-') &&
					(d.spec?.replicas ?? 0) > 0,
			);
		} catch (_err) {
			const err = _err as Error;
			this.logger.error(
				`Sleep Mode: erro ao listar deployments: ${err.message}`,
			);
			return;
		}

		for (const deployment of onlineServers) {
			const serverId = deployment.metadata?.name as string;
			const labels = deployment.metadata?.labels ?? {};
			const hibernateLabel = labels[HIBERNATE_LABEL];

			// Always On: ignora completamente
			if (!hibernateLabel || hibernateLabel === 'never') {
				this.inactiveSince.delete(serverId); // limpa se havia tracking anterior
				continue;
			}

			const thresholdMinutes = parseInt(hibernateLabel, 10);
			if (Number.isNaN(thresholdMinutes) || thresholdMinutes <= 0)
				continue;

			await this.checkServer(serverId, thresholdMinutes);
		}

		// Limpa o tracking de servidores que não existem mais
		for (const trackedId of this.inactiveSince.keys()) {
			const stillOnline = onlineServers.some(
				(d) => d.metadata?.name === trackedId,
			);
			if (!stillOnline) this.inactiveSince.delete(trackedId);
		}
	}

	// ---------------------------------------------------------------------------
	// Verifica um servidor específico e hiberna se necessário
	// ---------------------------------------------------------------------------
	private async checkServer(
		serverId: string,
		thresholdMinutes: number,
	): Promise<void> {
		try {
			const { online } = await this.serversService.getPlayers(serverId);

			if (online > 0) {
				// Tem jogadores — reseta o contador de inatividade
				if (this.inactiveSince.has(serverId)) {
					this.logger.debug(
						`Sleep Mode: ${serverId} voltou a ter jogadores. Contador resetado.`,
					);
					this.inactiveSince.delete(serverId);
				}
				return;
			}

			// 0 jogadores — inicia ou continua o tracking
			if (!this.inactiveSince.has(serverId)) {
				this.inactiveSince.set(serverId, new Date());
				this.logger.debug(
					`Sleep Mode: ${serverId} com 0 jogadores. Iniciando contagem (threshold: ${thresholdMinutes}min).`,
				);
				return;
			}

			const inactiveSince = this.inactiveSince.get(serverId) as Date;
			const inactiveMinutes = Math.floor(
				(Date.now() - inactiveSince.getTime()) / 60_000,
			);

			this.logger.debug(
				`Sleep Mode: ${serverId} inativo há ${inactiveMinutes}min (threshold: ${thresholdMinutes}min).`,
			);

			if (inactiveMinutes >= thresholdMinutes) {
				await this.hibernateServer(serverId);
				this.inactiveSince.delete(serverId);
			}
		} catch {
			// RCON falhou (servidor ainda iniciando, ou RCON não disponível) — ignora
			this.logger.debug(
				`Sleep Mode: ${serverId} RCON indisponível — pulando.`,
			);
		}
	}

	// ---------------------------------------------------------------------------
	// Hiberna um servidor (scale 0)
	// ---------------------------------------------------------------------------
	private async hibernateServer(serverId: string): Promise<void> {
		try {
			const deployment = await this.k8sAppsApi.readNamespacedDeployment({
				name: serverId,
				namespace: this.namespace,
			});
			if (deployment.spec) deployment.spec.replicas = 0;
			await this.k8sAppsApi.replaceNamespacedDeployment({
				name: serverId,
				namespace: this.namespace,
				body: deployment,
			});
			this.logger.log(
				`💤 Sleep Mode: "${serverId}" hibernado por inatividade.`,
			);
		} catch (_err) {
			const err = _err as Error;
			this.logger.error(
				`Sleep Mode: erro ao hibernar ${serverId}: ${err.message}`,
			);
		}
	}

	// ---------------------------------------------------------------------------
	// Atualiza a configuração de hibernação de um servidor
	// ---------------------------------------------------------------------------
	async setHibernateConfig(
		serverId: string,
		hibernateAfterMinutes: number | null,
	): Promise<{
		serverId: string;
		mode: string;
		hibernateAfterMinutes: number | null;
	}> {
		const deployment = await this.k8sAppsApi.readNamespacedDeployment({
			name: serverId,
			namespace: this.namespace,
		});

		// Garante que o objeto labels existe
		deployment.metadata = deployment.metadata ?? {};
		deployment.metadata.labels = deployment.metadata.labels ?? {};

		const labelValue =
			hibernateAfterMinutes === null
				? 'never'
				: String(hibernateAfterMinutes);

		deployment.metadata.labels[HIBERNATE_LABEL] = labelValue;

		await this.k8sAppsApi.replaceNamespacedDeployment({
			name: serverId,
			namespace: this.namespace,
			body: deployment,
		});

		// Reseta o tracking se mudou para Always On
		if (hibernateAfterMinutes === null) {
			this.inactiveSince.delete(serverId);
		}

		return {
			serverId,
			mode: hibernateAfterMinutes === null ? 'always-on' : 'hibernate',
			hibernateAfterMinutes,
		};
	}

	// ---------------------------------------------------------------------------
	// Retorna o status de Sleep Mode de todos os servidores online
	// ---------------------------------------------------------------------------
	async getSleepModeStatus(): Promise<SleepModeStatus[]> {
		const res = await this.k8sAppsApi.listNamespacedDeployment({
			namespace: this.namespace,
		});

		const mcDeployments = res.items.filter((d) =>
			d.metadata?.name?.startsWith('mc-'),
		);

		return mcDeployments.map((d) => {
			const serverId = d.metadata?.name as string;
			const labels = d.metadata?.labels ?? {};
			const hibernateLabel = labels[HIBERNATE_LABEL];

			const isAlwaysOn = !hibernateLabel || hibernateLabel === 'never';
			const thresholdMinutes = isAlwaysOn
				? null
				: parseInt(hibernateLabel, 10);

			const inactiveSince = this.inactiveSince.get(serverId) as Date;
			const inactiveMinutes = inactiveSince
				? Math.floor((Date.now() - inactiveSince.getTime()) / 60_000)
				: null;

			const willHibernateInMinutes =
				!isAlwaysOn &&
				thresholdMinutes !== null &&
				inactiveMinutes !== null
					? Math.max(0, thresholdMinutes - inactiveMinutes)
					: null;

			return {
				serverId,
				mode: isAlwaysOn ? 'always-on' : 'hibernate',
				hibernateAfterMinutes: thresholdMinutes,
				inactiveSinceMinutes: inactiveMinutes,
				willHibernateInMinutes,
			};
		});
	}
}
