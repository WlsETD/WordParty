import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Dictionary } from './dictionary/Dictionary.js';
import { createGameServer } from './transport/gateway.js';

const port = Number(process.env.PORT ?? 8080);
const dictPath = process.env.DICTIONARY_PATH ?? fileURLToPath(new URL('../data/enable1.txt', import.meta.url));
// The built phone/TV app: packages/web/dist, relative to this file (packages/server/dist/index.js).
const webDir = process.env.WEB_DIR ?? fileURLToPath(new URL('../../web/dist', import.meta.url));
const corsOrigin = process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim()) : '*';

if (!existsSync(dictPath)) {
  console.error(`Dictionary not found at ${dictPath}`);
  process.exit(1);
}

const dict = Dictionary.fromFile(dictPath);
const hasWeb = existsSync(`${webDir}/index.html`);
const server = createGameServer({ dict, corsOrigin, staticDir: hasWeb ? webDir : undefined });
const actual = await server.listen(port);
console.log(`接字派對 server listening on :${actual} (${dict.size} words, web: ${hasWeb ? webDir : 'not built'})`);

const shutdown = async () => {
  await server.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
