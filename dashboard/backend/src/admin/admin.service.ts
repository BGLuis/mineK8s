import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GatewayService } from '../gateway/gateway.service';

@Injectable()
export class AdminService {
  constructor(
    private prisma: PrismaService,
    private gateway: GatewayService
  ) {}

  // ---------------------------------------------------------
  // PLAYERS ONLINE (INTEGRAÇÃO COM GATEWAY TCP)
  // ---------------------------------------------------------
  getOnlinePlayers() {
    return this.gateway.getActivePlayers();
  }

  // ---------------------------------------------------------
  // USERS
  // ---------------------------------------------------------
  async createUser(data: { tailscaleUserId: string; email?: string; minecraftNick: string }) {
    return this.prisma.user.create({ data });
  }

  async getUsers() {
    return this.prisma.user.findMany({ include: { groups: true } });
  }

  // ---------------------------------------------------------
  // GROUPS
  // ---------------------------------------------------------
  async createGroup(data: { name: string; description?: string }) {
    return this.prisma.group.create({ data });
  }

  async getGroups() {
    return this.prisma.group.findMany({ include: { users: true, servers: true } });
  }

  // ---------------------------------------------------------
  // SERVERS
  // ---------------------------------------------------------
  async createServer(data: { name: string; subdomain: string; k8sServiceName: string; k8sServicePort: number }) {
    return this.prisma.server.create({ data });
  }

  async getServers() {
    return this.prisma.server.findMany({ include: { groups: true } });
  }

  // ---------------------------------------------------------
  // ASSOCIAÇÕES & REVOGAÇÕES
  // ---------------------------------------------------------
  async addUserToGroup(userId: string, groupId: string) {
    return this.prisma.userGroup.create({
      data: { userId, groupId }
    });
  }

  async addServerToGroup(serverId: string, groupId: string) {
    return this.prisma.serverGroup.create({
      data: { serverId, groupId }
    });
  }

  async removeUserFromGroup(userId: string, groupId: string) {
    await this.prisma.userGroup.delete({
      where: { userId_groupId: { userId, groupId } }
    });

    // SMART KICK: Se removemos ele de um grupo, podemos ser radicais e derrubá-lo caso esteja jogando algo.
    // Em produção você buscaria quais servers esse grupo dava acesso, e derrubaria ele especificamente de lá.
    // Para simplificar, poderíamos buscar as conexões dele e dropar, mas por ora vamos deixar o Gateway cuidar dos IPs.
    return { success: true, message: 'Usuário removido do grupo' };
  }
}
