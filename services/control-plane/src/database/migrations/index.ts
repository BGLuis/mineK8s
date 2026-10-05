import { InitialSchema1710000000000 } from './1710000000000-InitialSchema';
import { AddLifecycleRestartTracking1710000000001 } from './1710000000001-AddLifecycleRestartTracking';
import { AddLastPlayerActiveAt1710000000002 } from './1710000000002-AddLastPlayerActiveAt';
import { AddServerAccessPolicy1710000000003 } from './1710000000003-AddServerAccessPolicy';
import { AddInviteCreatedBy1710000000004 } from './1710000000004-AddInviteCreatedBy';
import { UniqueUserTailscaleId1710000000005 } from './1710000000005-UniqueUserTailscaleId';

export const migrations = [
  InitialSchema1710000000000,
  AddLifecycleRestartTracking1710000000001,
  AddLastPlayerActiveAt1710000000002,
  AddServerAccessPolicy1710000000003,
  AddInviteCreatedBy1710000000004,
  UniqueUserTailscaleId1710000000005,
];
