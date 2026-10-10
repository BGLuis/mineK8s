// The Service is named `mc-<resource_name>` and a Service name is a DNS-1123 label (63 characters at most).
export const MAX_RESOURCE_NAME_LENGTH = 60;

/** Name of the Deployment, Service and pod label of a server; `resourceName` is Server.resource_name. */
export function serverWorkloadName(resourceName: string): string {
  return `mc-${resourceName}`;
}

/**
 * A resource_name for a subdomain that another server already holds as its own (it was renamed away from it).
 * The base is cut so that the suffix always fits, and a hyphen left dangling by the cut is dropped to stay DNS-1123.
 */
export function disambiguatedResourceName(subdomain: string, suffix: string): string {
  const base = subdomain.slice(0, MAX_RESOURCE_NAME_LENGTH - suffix.length - 1).replace(/-+$/, '');
  return `${base}-${suffix}`;
}
