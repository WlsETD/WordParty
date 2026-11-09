/**
 * Manual smoke helper: joins a room with three autoplaying bots so a real TV / phone in the
 * browser can watch every mode being played.
 *
 *   npx tsx packages/server/test/smoke/bots.ts http://localhost:8090 ABCD
 */
import { enable } from '../helpers.js';
import { Bot } from '../integration/bot.js';

const [url = 'http://localhost:8090', code = ''] = process.argv.slice(2);
if (!code) {
  console.error('usage: bots.ts <url> <ROOMCODE>');
  process.exit(1);
}

const dict = enable();
const names = ['Bot1', 'Bot2', 'Bot3'];
const bots: Bot[] = [];
for (const [i, name] of names.entries()) {
  const b = await new Bot(url, name, dict, i).connect();
  await b.join(code);
  b.autoplay = true;
  bots.push(b);
  console.log(`${name} joined ${code}`);
}

// Keep the bots alive until the process is stopped.
setInterval(() => {
  const phase = bots[0].snapshot?.phase ?? '?';
  const mode = bots[0].snapshot?.modeState?.mode ?? '-';
  console.log(`phase=${phase} mode=${mode} words=${bots.reduce((n, b) => n + b.results.filter((r) => r.ok).length, 0)}`);
}, 15_000);
