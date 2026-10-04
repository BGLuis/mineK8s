import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';

import { TailscaleDevice } from '../../database/entities/tailscale-device.entity';
import { User } from '../../database/entities/user.entity';
import { Server } from '../../database/entities/server.entity';
import { TailscaleCloudDriver } from '../drivers/tailscale-cloud.driver';
import { MinecraftRconConsoleDriver } from '../../console/minecraft-rcon-console.driver';
import { GatewayIpcService } from '../../gateway-ipc/gateway-ipc.service';

@Injectable()
export class DevicesService {
  private readonly logger = new Logger(DevicesService.name);

  constructor(
    @InjectRepository(TailscaleDevice)
    private readonly deviceRepo: Repository<TailscaleDevice>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Server)
    private readonly serverRepo: Repository<Server>,
    private readonly tailscaleCloudDriver: TailscaleCloudDriver,
    private readonly consoleDriver: MinecraftRconConsoleDriver,
    private readonly gatewayIpcService: GatewayIpcService,
  ) {}

  /**
   * Lista todos os dispositivos registrados e seus status (RF-TS-07).
   */
  async listDevices(): Promise<TailscaleDevice[]> {
    return this.deviceRepo.find({
      relations: ['user'],
      order: { created_at: 'DESC' },
    });
  }

  /**
   * Obtém detalhes de um dispositivo pelo ID.
   */
  async getDeviceById(id: string): Promise<TailscaleDevice> {
    const device = await this.deviceRepo.findOne({
      where: { id },
      relations: ['user'],
    });

    if (!device) {
      throw new NotFoundException(`Device with ID "${id}" not found`);
    }

    return device;
  }

  /**
   * Executa o Nível 2 de Revogação: Ban de Rede Total e Exclusão do Nó da Tailnet (RF-TS-09).
   */
  async revokeDevice(deviceId: string): Promise<{ message: string; deviceId: string }> {
    const device = await this.deviceRepo.findOne({
      where: { id: deviceId },
      relations: ['user'],
    });

    if (!device) {
      throw new NotFoundException(`Device with ID "${deviceId}" not found`);
    }

    this.logger.warn(
      `Iniciando Revogação Nível 2 (Ban de Rede Total) para dispositivo ${device.id} (user: ${device.user?.minecraft_nick || 'unknown'})`,
    );

    // 1. Atualiza status no banco de dados para REVOKED
    device.status = 'REVOKED';
    await this.deviceRepo.save(device);

    // 2. Destrói forçosamente qualquer sessão ativa em todos os servidores do cluster (Smart Kick total)
    if (device.user) {
      const servers = await this.serverRepo.find({
        relations: ['minecraft_settings'],
      });

      const banMessage = '§cDispositivo banido da rede privada pelo administrador.';

      for (const server of servers) {
        // Envia RCON kick
        try {
          await this.consoleDriver.sendCommand(
            server,
            `kick ${device.user.minecraft_nick} Dispositivo banido da rede`,
          );
        } catch (rconErr: any) {
          this.logger.debug(`RCON kick bypass no servidor ${server.id}: ${rconErr.message}`);
        }
      }

      // O Gateway derruba de uma vez todas as sessões do IP do dispositivo, em qualquer servidor.
      // Sem IP registrado, cai para as sessões do nickname do dono em todos os servidores.
      try {
        const revoked = await this.gatewayIpcService.revokePlayerSession({
          server_id: '',
          client_ip: device.node_ip || '',
          minecraft_nick: device.node_ip ? '' : device.user.minecraft_nick,
          reason_message: banMessage,
        });
        this.logger.log(
          `Ban de rede do dispositivo ${device.id}: ${revoked.terminated_connections_count} sessão(ões) derrubada(s) no Gateway`,
        );
      } catch (ipcErr: any) {
        this.logger.warn(`Falha ao revogar as sessões do dispositivo ${device.id} no Gateway: ${ipcErr.message}`);
      }
    }

    // 3. Remove o nó da malha da Tailnet via Tailscale Cloud API (RF-TS-07, RF-TS-09)
    const externalId = device.node_id || device.id;
    try {
      await this.tailscaleCloudDriver.deleteDevice(externalId);
      this.logger.log(`Nó ${externalId} excluído com sucesso da Tailnet via Cloud API`);
    } catch (cloudErr: any) {
      this.logger.warn(
        `Falha ao excluir nó ${externalId} na Cloud API (pode já estar ausente): ${cloudErr.message}`,
      );
    }

    return {
      message: 'Device revoked successfully and removed from the Tailnet',
      deviceId,
    };
  }

  /**
   * DeviceGarbageCollector: Coleta e exclusão automática de nós inativos > 30 dias (RF-TS-15, E-03).
   */
  async cleanInactiveDevices(thresholdDays = 30): Promise<{ removedCount: number; removedDeviceIds: string[] }> {
    const cutoffDate = new Date(Date.now() - thresholdDays * 24 * 60 * 60 * 1000);
    const pendingCutoffDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // chaves pendentes > 7 dias

    // 1. Busca dispositivos ativos inativos há mais de 30 dias
    const inactiveDevices = await this.deviceRepo.find({
      where: [
        { status: 'ACTIVE', last_seen_at: LessThan(cutoffDate) },
        { status: 'PENDING', created_at: LessThan(pendingCutoffDate) },
      ],
    });

    this.logger.log(
      `DeviceGarbageCollector: Encontrados ${inactiveDevices.length} dispositivos inativos (> ${thresholdDays} dias)`,
    );

    const removedDeviceIds: string[] = [];

    for (const dev of inactiveDevices) {
      dev.status = 'REVOKED';
      await this.deviceRepo.save(dev);

      const externalId = dev.node_id || dev.id;
      try {
        await this.tailscaleCloudDriver.deleteDevice(externalId);
        removedDeviceIds.push(dev.id);
      } catch (err: any) {
        this.logger.warn(`DeviceGarbageCollector: Falha ao deletar nó ${externalId}: ${err.message}`);
      }
    }

    return {
      removedCount: removedDeviceIds.length,
      removedDeviceIds,
    };
  }
}
