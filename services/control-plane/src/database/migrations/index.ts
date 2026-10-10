import { InitialSchema1710000000000 } from './1710000000000-InitialSchema';
import { AddLifecycleRestartTracking1710000000001 } from './1710000000001-AddLifecycleRestartTracking';
import { AddLastPlayerActiveAt1710000000002 } from './1710000000002-AddLastPlayerActiveAt';
import { AddServerAccessPolicy1710000000003 } from './1710000000003-AddServerAccessPolicy';
import { AddInviteCreatedBy1710000000004 } from './1710000000004-AddInviteCreatedBy';
import { UniqueUserTailscaleId1710000000005 } from './1710000000005-UniqueUserTailscaleId';
import { AddBackupModpackCasTables1710000000006 } from './1710000000006-AddBackupModpackCasTables';
import { AddServerRuntime1710000000007 } from './1710000000007-AddServerRuntime';
import { AddServerResourceName1710000000008 } from './1710000000008-AddServerResourceName';
import { AddServerLanguage1710000000009 } from './1710000000009-AddServerLanguage';

export const migrations = [
  InitialSchema1710000000000,
  AddLifecycleRestartTracking1710000000001,
  AddLastPlayerActiveAt1710000000002,
  AddServerAccessPolicy1710000000003,
  AddInviteCreatedBy1710000000004,
  UniqueUserTailscaleId1710000000005,
  AddBackupModpackCasTables1710000000006,
  AddServerRuntime1710000000007,
  AddServerResourceName1710000000008,
  AddServerLanguage1710000000009,
];
