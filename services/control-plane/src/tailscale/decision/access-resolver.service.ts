import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { Group } from '../../database/entities/group.entity';
import { Server } from '../../database/entities/server.entity';
import { ServerGroup } from '../../database/entities/server-group.entity';
import { User } from '../../database/entities/user.entity';
import { UserGroup } from '../../database/entities/user-group.entity';
import { UserServerAccess } from '../../database/entities/user-server-access.entity';
import {
  AccessDecisionEngineService,
  ServerContext,
  UserContext,
} from './access-decision-engine.service';
import { effectiveAccessPolicy } from './effective-access-policy';

export type AccessGrantedBy =
  | { kind: 'ADMIN' }
  | { kind: 'POLICY'; policy: 'PUBLIC' | 'INTERNET' }
  | { kind: 'GROUP'; groupIds: string[]; groupNames?: string[] }
  | { kind: 'DIRECT' };

export interface AccessExplanation {
  userId: string;
  serverId: string;
  allowed: boolean;
  reason: string;
  grantedBy: AccessGrantedBy | null;
}

export interface HypotheticalAccessDiff {
  addUserToGroup?: Array<{ userId: string; groupId: string }>;
  removeUserFromGroup?: Array<{ userId: string; groupId: string }>;
  addServerToGroup?: Array<{ serverId: string; groupId: string }>;
  removeServerFromGroup?: Array<{ serverId: string; groupId: string }>;
  grantServer?: Array<{ userId: string; serverId: string }>;
  revokeServer?: Array<{ userId: string; serverId: string }>;
  deleteGroupIds?: string[];
}

@Injectable()
export class AccessResolverService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Server)
    private readonly serverRepo: Repository<Server>,
    @InjectRepository(ServerGroup)
    private readonly serverGroupRepo: Repository<ServerGroup>,
    @InjectRepository(UserGroup)
    private readonly userGroupRepo: Repository<UserGroup>,
    @InjectRepository(UserServerAccess)
    private readonly userServerAccessRepo: Repository<UserServerAccess>,
    @InjectRepository(Group)
    private readonly groupRepo: Repository<Group>,
    private readonly accessDecisionEngine: AccessDecisionEngineService,
  ) {}

  async explain(
    userIds: string[],
    opts?: {
      serverIds?: string[];
      hypothetical?: HypotheticalAccessDiff;
      users?: User[];
      servers?: Server[];
    },
  ): Promise<AccessExplanation[]> {
    const [users, servers] = await Promise.all([
      opts?.users ??
        (userIds.length > 0
          ? this.userRepo.find({ where: { id: In(userIds) } })
          : this.userRepo.find()),
      opts?.servers ??
        (opts?.serverIds && opts.serverIds.length > 0
          ? this.serverRepo.find({ where: { id: In(opts.serverIds) }, order: { name: 'ASC' } })
          : this.serverRepo.find({ order: { name: 'ASC' } })),
    ]);

    const [serverGroups, userGroups, userAccesses] = await Promise.all([
      this.serverGroupRepo.find({ relations: { group: true } }),
      userIds.length > 0
        ? this.userGroupRepo.find({ where: { user_id: In(userIds) } })
        : this.userGroupRepo.find(),
      userIds.length > 0
        ? this.userServerAccessRepo.find({ where: { user_id: In(userIds) } })
        : this.userServerAccessRepo.find(),
    ]);

    const groupNameMap = new Map<string, string>();
    for (const sg of serverGroups) {
      if ((sg as any).group?.name) {
        groupNameMap.set(sg.group_id, (sg as any).group.name);
      }
    }

    const deletedGroupIds = new Set(opts?.hypothetical?.deleteGroupIds ?? []);

    const userGroupMap = new Map<string, Set<string>>();
    for (const ug of userGroups) {
      if (deletedGroupIds.has(ug.group_id)) continue;
      let set = userGroupMap.get(ug.user_id);
      if (!set) {
        set = new Set();
        userGroupMap.set(ug.user_id, set);
      }
      set.add(ug.group_id);
    }
    for (const user of users) {
      if ((user as any).user_groups) {
        let set = userGroupMap.get(user.id);
        if (!set) {
          set = new Set();
          userGroupMap.set(user.id, set);
        }
        for (const ug of (user as any).user_groups) {
          const gid = ug.group_id ?? ug.id;
          if (gid && !deletedGroupIds.has(gid)) {
            set.add(gid);
          }
        }
      }
    }

    const serverGroupMap = new Map<string, Set<string>>();
    for (const sg of serverGroups) {
      if (deletedGroupIds.has(sg.group_id)) continue;
      let set = serverGroupMap.get(sg.server_id);
      if (!set) {
        set = new Set();
        serverGroupMap.set(sg.server_id, set);
      }
      set.add(sg.group_id);
    }
    for (const server of servers) {
      if ((server as any).server_groups) {
        let set = serverGroupMap.get(server.id);
        if (!set) {
          set = new Set();
          serverGroupMap.set(server.id, set);
        }
        for (const sg of (server as any).server_groups) {
          const gid = sg.group_id ?? sg.id;
          if (gid && !deletedGroupIds.has(gid)) {
            set.add(gid);
          }
        }
      }
    }

    const userDirectAccessMap = new Map<string, Set<string>>();
    for (const ua of userAccesses) {
      let set = userDirectAccessMap.get(ua.user_id);
      if (!set) {
        set = new Set();
        userDirectAccessMap.set(ua.user_id, set);
      }
      set.add(ua.server_id);
    }
    for (const user of users) {
      if ((user as any).server_accesses) {
        let set = userDirectAccessMap.get(user.id);
        if (!set) {
          set = new Set();
          userDirectAccessMap.set(user.id, set);
        }
        for (const sa of (user as any).server_accesses) {
          const sid = sa.server_id ?? sa.id;
          if (sid) {
            set.add(sid);
          }
        }
      }
    }

    if (opts?.hypothetical) {
      const h = opts.hypothetical;

      if (h.removeUserFromGroup) {
        for (const item of h.removeUserFromGroup) {
          userGroupMap.get(item.userId)?.delete(item.groupId);
        }
      }

      if (h.addUserToGroup) {
        for (const item of h.addUserToGroup) {
          if (deletedGroupIds.has(item.groupId)) continue;
          let set = userGroupMap.get(item.userId);
          if (!set) {
            set = new Set();
            userGroupMap.set(item.userId, set);
          }
          set.add(item.groupId);
        }
      }

      if (h.removeServerFromGroup) {
        for (const item of h.removeServerFromGroup) {
          serverGroupMap.get(item.serverId)?.delete(item.groupId);
        }
      }

      if (h.addServerToGroup) {
        for (const item of h.addServerToGroup) {
          if (deletedGroupIds.has(item.groupId)) continue;
          let set = serverGroupMap.get(item.serverId);
          if (!set) {
            set = new Set();
            serverGroupMap.set(item.serverId, set);
          }
          set.add(item.groupId);
        }
      }

      if (h.revokeServer) {
        for (const item of h.revokeServer) {
          userDirectAccessMap.get(item.userId)?.delete(item.serverId);
        }
      }

      if (h.grantServer) {
        for (const item of h.grantServer) {
          let set = userDirectAccessMap.get(item.userId);
          if (!set) {
            set = new Set();
            userDirectAccessMap.set(item.userId, set);
          }
          set.add(item.serverId);
        }
      }
    }

    const explanations: AccessExplanation[] = [];

    for (const user of users) {
      const userGroupIds = Array.from(userGroupMap.get(user.id) || []);
      const userIsActive =
        (user as any).isActive !== undefined
          ? (user as any).isActive
          : (user as any).is_active !== undefined
            ? (user as any).is_active
            : true;

      const userCtx: UserContext = {
        userId: user.id,
        minecraftNick: user.minecraft_nick,
        role: user.role,
        groupIds: userGroupIds,
        isActive: userIsActive,
      };

      for (const server of servers) {
        const serverAllowedGroupIds = Array.from(serverGroupMap.get(server.id) || []);
        const directServers = userDirectAccessMap.get(user.id);
        const serverAllowedUserIds = directServers?.has(server.id) ? [user.id] : [];
        const policy = effectiveAccessPolicy(server);

        const serverCtx: ServerContext = {
          serverId: server.id,
          policy,
          allowedGroupIds: serverAllowedGroupIds,
          allowedUserIds: serverAllowedUserIds,
        };

        const decision = this.accessDecisionEngine.evaluateAccess(userCtx, serverCtx);

        let grantedBy: AccessGrantedBy | null = null;

        if (decision.allowed) {
          if (user.role === 'ADMIN') {
            grantedBy = { kind: 'ADMIN' };
          } else if (policy === 'PUBLIC' || policy === 'INTERNET') {
            grantedBy = { kind: 'POLICY', policy };
          } else if (policy === 'GROUP') {
            const userGroupsSet = userGroupMap.get(user.id);
            const matchingGroupIds = serverAllowedGroupIds.filter((gid) => userGroupsSet?.has(gid));
            const names = matchingGroupIds
              .map((gid) => groupNameMap.get(gid))
              .filter((n): n is string => Boolean(n));
            grantedBy = {
              kind: 'GROUP',
              groupIds: matchingGroupIds,
              ...(names.length > 0 ? { groupNames: names } : {}),
            };
          } else if (policy === 'INDIVIDUAL') {
            grantedBy = { kind: 'DIRECT' };
          }
        }

        explanations.push({
          userId: user.id,
          serverId: server.id,
          allowed: decision.allowed,
          reason: decision.reason || (decision.allowed ? 'ALLOWED' : 'DENIED'),
          grantedBy,
        });
      }
    }

    return explanations;
  }
}
