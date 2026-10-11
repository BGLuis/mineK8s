export interface NetworkIdentity {
  userId: string;
  loginName: string;
  displayName: string;
  nodeId: string;
  nodeName: string;
  nodeIp: string;
  tags: string[];
  isOwner: boolean;
}

export interface PreAuthKeyResult {
  key: string;
  id: string;
  expires: Date;
  tags: string[];
}

export interface AclComplianceReport {
  compliant: boolean;
  issues: string[];
  auditedAt: Date;
}

/** Static tag of every invited player: the tailnet policy cannot declare one tag per player. */
export const PLAYER_TAG = 'tag:mc-player';

export const NETWORK_IDENTITY_PROVIDER = Symbol('NETWORK_IDENTITY_PROVIDER');

export interface NetworkIdentityProvider {
  resolveIdentity(clientIp: string): Promise<NetworkIdentity | null>;
  revokeDevice(deviceId: string): Promise<boolean>;
  generateInviteKey(tags: string[], expirySeconds?: number): Promise<PreAuthKeyResult>;
  auditAclCompliance(): Promise<AclComplianceReport>;
}
