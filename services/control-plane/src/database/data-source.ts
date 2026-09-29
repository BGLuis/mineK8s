import { DataSource } from 'typeorm';

import {
  Group,
  Invite,
  InviteGroup,
  InviteServer,
  MinecraftServerSettings,
  Server,
  ServerAuditLog,
  ServerGroup,
  TailscaleDevice,
  User,
  UserGroup,
  UserServerAccess,
} from './entities';
import { InitialSchema1710000000000 } from './migrations/1710000000000-InitialSchema';

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  username: process.env.DB_USER || 'minek8s',
  password: process.env.DB_PASSWORD || 'minek8s_secret_change_in_production',
  database: process.env.DB_NAME || 'minekubernetes',
  ssl: process.env.DB_SSL === 'true',
  synchronize: process.env.DB_SYNCHRONIZE === 'true',
  logging: process.env.DB_LOGGING === 'true',
  entities: [
    Server,
    MinecraftServerSettings,
    User,
    TailscaleDevice,
    Group,
    UserGroup,
    ServerGroup,
    UserServerAccess,
    Invite,
    InviteGroup,
    InviteServer,
    ServerAuditLog,
  ],
  migrations: [InitialSchema1710000000000],
});
