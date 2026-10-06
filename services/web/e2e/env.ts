/** Ports and fixed values shared by the global setup, the Playwright config and the specs. */
const port = (name: string, fallback: number) => Number(process.env[name] ?? fallback);

export const SPA_PORT = port('E2E_SPA_PORT', 4290);
export const CONTROL_PLANE_PORT = port('E2E_CONTROL_PLANE_PORT', 3390);
export const GRPC_PORT = port('E2E_GRPC_PORT', 50690);
export const POSTGRES_PORT = port('E2E_POSTGRES_PORT', 55490);
export const CLOUD_API_PORT = port('E2E_CLOUD_API_PORT', 3391);
export const MOJANG_META_PORT = port('E2E_MOJANG_META_PORT', 3392);

// With the mock k8s driver the control plane reaches every game server at 127.0.0.1 on the
// ports the manifests use (RconConnectionPool, ReconcilerService.getProbeHost), so these are fixed.
export const RCON_PORT = 25575;
export const SLP_PORT = 25565;

export const SPA_URL = `http://localhost:${SPA_PORT}`;
export const CONTROL_PLANE_URL = `http://127.0.0.1:${CONTROL_PLANE_PORT}`;

export const BOOTSTRAP_TOKEN = 'e2e-bootstrap-token';

/** The single tailnet identity the fake LocalAPI reports for every address: the admin's laptop. */
export const ADMIN_TAILSCALE = {
  userId: 4242,
  loginName: 'admin@e2e.test',
  nodeName: 'admin-laptop',
};
