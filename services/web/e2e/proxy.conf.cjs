// Same routes as proxy.conf.json, pointed at the control plane that e2e/global-setup.ts starts.
const target = `http://127.0.0.1:${process.env.E2E_CONTROL_PLANE_PORT ?? 3390}`;
const route = { target, secure: false, changeOrigin: true };
const socket = { ...route, ws: true };

module.exports = {
  '/api': route,
  '/socket.io': socket,
  '/ws': socket,
  '/terminal': socket,
};
