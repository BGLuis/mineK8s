export interface TailscaleWhoIsUserProfile {
  ID: number;
  LoginName: string;
  DisplayName: string;
  ProfilePicURL?: string;
  Roles?: string[];
}

export interface TailscaleWhoIsNode {
  ID: number;
  StableID: string;
  Name: string;
  User: number;
  Addresses: string[];
  Tags?: string[];
  PrimaryRoutes?: string[];
  Hostinfo?: {
    OS?: string;
    Hostname?: string;
  };
}

export interface TailscaleWhoIsResponse {
  Node: TailscaleWhoIsNode;
  UserProfile: TailscaleWhoIsUserProfile;
  CapMap?: Record<string, unknown>;
}

export class LocalSocketUnavailableException extends Error {
  constructor(message: string, public readonly code: string = 'ENOENT') {
    super(message);
    this.name = 'LocalSocketUnavailableException';
  }
}
