export function injectTailscaleSidecar(deploymentManifest: any, authKey: string): any {
    if (!deploymentManifest || typeof deploymentManifest !== 'object') {
        throw new Error("Invalid deployment manifest");
    }

    // Ensure the nested structure exists
    deploymentManifest.spec = deploymentManifest.spec || {};
    deploymentManifest.spec.template = deploymentManifest.spec.template || {};
    deploymentManifest.spec.template.spec = deploymentManifest.spec.template.spec || {};
    deploymentManifest.spec.template.spec.containers = deploymentManifest.spec.template.spec.containers || [];

    // Define the Tailscale sidecar container
    const tailscaleSidecar = {
        name: "tailscale",
        image: "tailscale/tailscale:latest",
        env: [
            {
                name: "TS_AUTHKEY",
                value: authKey
            },
            {
                name: "TS_USERSPACE",
                value: "false"
            }
        ],
        securityContext: {
            capabilities: {
                add: ["NET_ADMIN"]
            },
            privileged: true
        }
    };

    // Inject the sidecar into the containers array
    deploymentManifest.spec.template.spec.containers.push(tailscaleSidecar);

    return deploymentManifest;
}
