/**
 * O contrato (`proto/gateway_control.proto`) e as interfaces TypeScript usam snake_case.
 * Sem `keepCase` o proto-loader entrega e espera camelCase: o snapshot de rotas perderia
 * `server_id`, `access_policy` e `auto_wake`, e os eventos de sessão chegariam com outros nomes.
 * `longs: Number` mantém `timestamp_epoch_ms` como number, como nas interfaces.
 */
export const GATEWAY_GRPC_LOADER_OPTIONS = { keepCase: true, longs: Number } as const;
