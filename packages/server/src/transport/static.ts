import { createReadStream, existsSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

/**
 * Serves the built web app from `root`. Unknown page paths (e.g. `/tv`) get index.html so the
 * client router can take over. Returns false when the request was not handled.
 */
export function createStaticHandler(root: string): (req: IncomingMessage, res: ServerResponse) => boolean {
  const base = normalize(root);
  const index = join(base, 'index.html');

  return (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    } catch {
      return false;
    }

    const file = normalize(join(base, pathname));
    if (file !== base && !file.startsWith(base + sep)) {
      res.writeHead(400).end();
      return true;
    }

    let target = file;
    if (!existsSync(target) || statSync(target).isDirectory()) {
      // Real asset paths that are missing should 404; anything else is a page route.
      if (extname(pathname)) return false;
      target = index;
    }
    if (!existsSync(target)) return false;

    const hashed = target.includes(`${sep}assets${sep}`);
    res.writeHead(200, {
      'content-type': TYPES[extname(target)] ?? 'application/octet-stream',
      'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    if (req.method === 'HEAD') {
      res.end();
    } else {
      createReadStream(target).pipe(res);
    }
    return true;
  };
}
