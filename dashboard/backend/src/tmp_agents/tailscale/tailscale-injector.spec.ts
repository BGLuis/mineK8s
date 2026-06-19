import { injectTailscaleSidecar } from './tailscale-injector';

describe('Tailscale Injector', () => {
  it('should inject tailscale sidecar with correct auth key', () => {
    const mockManifest = {
      spec: {
        template: {
          spec: {
            containers: [
              { name: 'minecraft', image: 'itzg/minecraft-server' }
            ]
          }
        }
      }
    };

    const result = injectTailscaleSidecar(mockManifest, 'tskey-auth-mock123');
    
    expect(result.spec.template.spec.containers.length).toBe(2);
    const sidecar = result.spec.template.spec.containers[1];
    expect(sidecar.name).toBe('tailscale');
    expect(sidecar.image).toBe('tailscale/tailscale:latest');
    expect(sidecar.env.find((e: any) => e.name === 'TS_AUTHKEY')?.value).toBe('tskey-auth-mock123');
    expect(sidecar.securityContext.privileged).toBe(true);
  });
});
