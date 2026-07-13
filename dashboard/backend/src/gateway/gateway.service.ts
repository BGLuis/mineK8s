import * as net from 'node:net';
import {
	Injectable,
	Logger,
	OnModuleDestroy,
	OnModuleInit,
} from '@nestjs/common';
import { AppConfigService } from '../app-config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { TailscaleService } from '../tailscale/tailscale.service';
import { MinecraftProtocol } from './minecraft-protocol.util';

@Injectable()
export class GatewayService implements OnModuleInit, OnModuleDestroy {
	private readonly logger = new Logger(GatewayService.name);
	private server: net.Server;

	// Mapa de conexões ativas: ClientIP -> Socket de quem está jogando
	private activeConnections: Map<
		string,
		{ socket: net.Socket; domain: string }
	> = new Map();

	constructor(
		private tailscaleService: TailscaleService,
		private prisma: PrismaService,
		private appConfig: AppConfigService,
	) {}

	onModuleInit() {
		if (this.appConfig.nodeEnv === 'test') {
			this.logger.log(
				'Modo Teste: Gateway TCP não irá abrir porta localmente.',
			);
			return;
		}
		this.logger.log('Iniciando MineKube TCP Gateway na porta 25565...');
		this.server = net.createServer((socket) =>
			this.handleConnection(socket),
		);

		this.server.listen(25565, '0.0.0.0', () => {
			this.logger.log('✅ Gateway TCP rodando em 0.0.0.0:25565');
		});
	}

	onModuleDestroy() {
		if (this.server) {
			this.server.close();
		}
	}

	private async handleConnection(clientSocket: net.Socket) {
		const clientIp = clientSocket.remoteAddress;
		if (!clientIp) {
			clientSocket.end();
			return;
		}

		clientSocket.once('data', async (firstChunk) => {
			try {
				// Pausar para segurar os pacotes seguintes (como Login Start) no buffer interno do SO/Node
				clientSocket.pause();

				// Devolve o pacote para a stream para que o pipe() o envie de forma contígua e intacta
				clientSocket.unshift(firstChunk);

				// --- 1. Lendo o Handshake ---
				let offset = 0;
				const data = firstChunk;

				// Packet Length
				const packetLen = MinecraftProtocol.readVarInt(data, offset);
				offset += packetLen.bytesRead;

				// Packet ID (0x00 para Handshake)
				const packetId = MinecraftProtocol.readVarInt(data, offset);
				offset += packetId.bytesRead;

				if (packetId.value !== 0x00) {
					throw new Error('Pacote inicial não é um Handshake');
				}

				// Protocol Version
				const protocolVersion = MinecraftProtocol.readVarInt(
					data,
					offset,
				);
				offset += protocolVersion.bytesRead;

				// Server Address (O domínio que o cara digitou)
				const serverAddressStr = MinecraftProtocol.readString(
					data,
					offset,
				);
				offset += serverAddressStr.bytesRead;

				// Limpando a string (Forge e outros mods enviam sujeiras tipo \0FML\0)
				const requestedDomain = serverAddressStr.value.split('\\0')[0];

				// Server Port
				const _serverPort = data.readUInt16BE(offset);
				offset += 2;

				// Next State (1 = Status/Ping, 2 = Login/Jogar)
				const nextState = MinecraftProtocol.readVarInt(
					data,
					offset,
				).value;

				this.logger.log(
					`[${clientIp}] solicitou domínio: ${requestedDomain} (State: ${nextState})`,
				);

				// --- 2. Autorização (Lógica de IP do Tailscale x Domínio) ---
				const authResult = await this.checkAuthorization(
					clientIp,
					requestedDomain,
				);

				if (!authResult.authorized) {
					this.logger.warn(
						`Acesso negado para ${clientIp} no domínio ${requestedDomain}`,
					);
					if (nextState === 2) {
						const disconnectData =
							MinecraftProtocol.createDisconnectPacket(
								'MineKube 🦊\nVocê não tem permissão para acessar este servidor!',
							);
						clientSocket.write(disconnectData);
					}
					clientSocket.end();
					return;
				}

				// Registra a conexão ativa
				this.activeConnections.set(clientIp, {
					socket: clientSocket,
					domain: requestedDomain,
				});

				// --- 3. Roteamento Interno ---
				const targetHost = (
					authResult.server as {
						k8sServiceName: string;
						k8sServicePort: number;
					}
				).k8sServiceName;
				const targetPort = (
					authResult.server as {
						k8sServiceName: string;
						k8sServicePort: number;
					}
				).k8sServicePort;

				this.logger.log(
					`Conectando ${clientIp} -> ${targetHost}:${targetPort}`,
				);
				const serverSocket = net.connect(
					{ host: targetHost, port: targetPort },
					() => {
						// Como fizemos unshift(), o pipe() enviará o Handshake original junto com qualquer dado pendente
						clientSocket.pipe(serverSocket);
						serverSocket.pipe(clientSocket);

						// Libera a represa
						clientSocket.resume();
					},
				);

				serverSocket.on('error', (err) => {
					this.logger.error(
						`Erro conectando ao servidor interno: ${err.message}`,
					);
					clientSocket.end();
					this.activeConnections.delete(clientIp);
				});

				clientSocket.on('error', () => {
					serverSocket.end();
					this.activeConnections.delete(clientIp);
				});

				clientSocket.on('close', () => {
					this.logger.log(
						`Jogador ${clientIp} desconectou do ${requestedDomain}`,
					);
					this.activeConnections.delete(clientIp);
				});
			} catch (err) {
				this.logger.error(
					`Falha ao processar Handshake de ${clientIp}: ${err.message}`,
				);
				clientSocket.end();
				this.activeConnections.delete(clientIp);
			}
		});
	}

	// -------------------------------------------------------------------------
	// Métodos expostos para a API do NestJS
	// -------------------------------------------------------------------------

	/** Retorna todos os jogadores que estão online e em quais mundos */
	getActivePlayers() {
		const players: { ip: string; world: string }[] = [];
		for (const [ip, data] of this.activeConnections.entries()) {
			players.push({ ip, world: data.domain });
		}
		return players;
	}

	/** Chuta um IP se ele estiver em um mundo específico (chamado quando perde permissão) */
	kickPlayerFromWorld(clientIp: string, domain: string) {
		const conn = this.activeConnections.get(clientIp);
		if (conn && conn.domain === domain) {
			this.logger.warn(
				`Derrubando a conexão de ${clientIp} do mundo ${domain} (Permissão revogada)`,
			);
			// Envia pacote bonitinho de Kick
			const disconnectData = MinecraftProtocol.createDisconnectPacket(
				'Sua permissão de acesso a este servidor foi revogada.',
			);
			conn.socket.write(disconnectData);

			// Fecha o socket TCP na marra
			conn.socket.end();
			conn.socket.destroy();
			this.activeConnections.delete(clientIp);
		}
	}

	// -------------------------------------------------------------------------
	// Lógica Principal de Autorização Integrada ao Prisma e Tailscale
	// -------------------------------------------------------------------------
	private async checkAuthorization(
		clientIp: string,
		requestedDomain: string,
	): Promise<{ authorized: boolean; server?: Record<string, unknown> }> {
		try {
			// 1. O servidor (domínio) existe no nosso banco de dados?
			const server = await this.prisma.server.findUnique({
				where: { subdomain: requestedDomain },
				include: { groups: { include: { group: true } } },
			});

			if (!server) {
				this.logger.debug(
					`Domínio não encontrado no banco: ${requestedDomain}`,
				);
				return { authorized: false };
			}

			// 2. Descobrir quem é o dono desse IP no Tailscale
			const tailscaleUserId =
				await this.tailscaleService.getDeviceOwner(clientIp);

			if (!tailscaleUserId) {
				this.logger.warn(
					`Conexão bloqueada: IP ${clientIp} não foi encontrado na Tailnet.`,
				);
				return { authorized: false };
			}

			// 3. Buscar o usuário no banco
			const user = await this.prisma.user.findFirst({
				where: { tailscaleUserId },
				include: { groups: true },
			});

			if (!user) {
				this.logger.debug(
					`Usuário do Tailscale ${tailscaleUserId} (IP ${clientIp}) não está vinculado no painel.`,
				);
				return { authorized: false };
			}

			// Se o usuário for ADMIN, damos bypass e liberamos acesso a qualquer servidor
			if (user.role === 'ADMIN') {
				this.logger.log(
					`Acesso master liberado para ADMIN ${user.minecraftNick} no servidor ${server.name}`,
				);
				return { authorized: true, server };
			}

			// Apenas não-admins chegarão aqui. Se o servidor não tiver grupos, negamos.
			if (server.groups.length === 0) {
				this.logger.debug(
					`Servidor ${requestedDomain} não pertence a nenhum grupo. Bloqueado para usuários normais.`,
				);
				return { authorized: false };
			}

			// 4. Bater as permissões (Interseção entre Grupos do Servidor x Grupos do Usuário)
			const userGroupIds = user.groups.map((g) => g.groupId);
			const serverGroupIds = server.groups.map((g) => g.groupId);

			const hasAccess = userGroupIds.some((groupId) =>
				serverGroupIds.includes(groupId),
			);

			if (!hasAccess) {
				this.logger.debug(
					`Usuário ${user.minecraftNick} não tem acesso ao servidor ${server.name}`,
				);
				return { authorized: false };
			}

			return { authorized: true, server };
		} catch (err) {
			this.logger.error(
				`Erro na checagem de autorização: ${err.message}`,
			);
			return { authorized: false };
		}
	}
}
