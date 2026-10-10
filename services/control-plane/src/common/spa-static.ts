import * as fs from 'fs';
import * as path from 'path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import type { HelmetOptions } from 'helmet';

/** Paths Nest answers itself; an unknown `/api` route must stay a JSON 404, not turn into the SPA. */
const BACKEND_PREFIXES = ['/api', '/socket.io', '/healthz'];

/**
 * Helmet's default policy, adjusted for the Angular build in services/web: scripts only from this origin and never
 * inline, fonts self-hosted, images from this origin (and `blob:`, for the icon preview) plus the player heads of mc-heads.net. Angular inserts component styles as `<style>` elements at runtime, so styles keep
 * 'unsafe-inline'. The panel is reached over plain HTTP inside the tailnet, where upgrade-insecure-requests would
 * rewrite every asset URL to an https:// origin that does not exist.
 */
export const SPA_HELMET_OPTIONS: HelmetOptions = {
  contentSecurityPolicy: {
    directives: {
      'font-src': ["'self'"],
      'img-src': ["'self'", 'data:', 'blob:', 'https://mc-heads.net'],
      'style-src': ["'self'", "'unsafe-inline'"],
      'upgrade-insecure-requests': null,
    },
  },
};

/**
 * Serves the SPA build from `root`: its files as they are, and `index.html` for any other GET outside the backend
 * prefixes, so deep links such as `/join?token=...` reach the Angular router. Returns false, serving nothing, when
 * `root` holds no build.
 */
export function serveSpa(app: NestExpressApplication, root: string): boolean {
  const indexPath = path.join(root, 'index.html');
  if (!fs.existsSync(indexPath)) {
    return false;
  }

  app.useStaticAssets(root, { index: false });
  app.use((req: Request, res: Response, next: NextFunction) => {
    const isPageRequest =
      (req.method === 'GET' || req.method === 'HEAD') && !path.extname(req.path);
    if (!isPageRequest || isBackendPath(req.path)) {
      return next();
    }
    // The hashed bundles may be cached forever; the page that names them must be revalidated after each deploy.
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(indexPath);
  });
  return true;
}

function isBackendPath(requestPath: string): boolean {
  return BACKEND_PREFIXES.some(
    (prefix) => requestPath === prefix || requestPath.startsWith(`${prefix}/`),
  );
}
