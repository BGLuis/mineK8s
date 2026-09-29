export interface DnsRecordInput {
  type: 'A' | 'AAAA' | 'CNAME' | 'TXT' | 'SRV';
  name: string;
  content?: string;
  ttl?: number;
  proxied?: boolean;
  priority?: number;
  data?: {
    service?: string;
    proto?: string;
    name?: string;
    priority?: number;
    weight?: number;
    port?: number;
    target?: string;
  };
}

export interface DnsRecordResult {
  id: string;
  type: string;
  name: string;
  content: string;
  proxied?: boolean;
  ttl: number;
  data?: any;
}

export interface DnsRecordFilter {
  type?: string;
  name?: string;
}

export interface IDnsDriver {
  listRecords(filter?: DnsRecordFilter): Promise<DnsRecordResult[]>;
  createRecord(record: DnsRecordInput): Promise<DnsRecordResult>;
  updateRecord(recordId: string, record: DnsRecordInput): Promise<DnsRecordResult>;
  deleteRecord(recordId: string): Promise<boolean>;
  deleteRecordByNameAndType(name: string, type: string): Promise<boolean>;
  upsertWildcardA(domain: string, publicIp: string): Promise<DnsRecordResult>;
  upsertSrvRecord(
    name: string,
    target: string,
    port: number,
    priority?: number,
    weight?: number,
  ): Promise<DnsRecordResult>;
}
