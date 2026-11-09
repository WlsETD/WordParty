/**
 * Generates docs/PROTOCOL.md from the TypeScript sources in packages/shared/src.
 * Run with: npm run gen:protocol
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const src = (f: string) => fileURLToPath(new URL(`../src/${f}`, import.meta.url));
const OUT = fileURLToPath(new URL('../../../docs/PROTOCOL.md', import.meta.url));

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(file, readFileSync(src(file), 'utf8'), ts.ScriptTarget.Latest, true);
}

function jsdoc(node: ts.Node): string {
  const docs = (node as { jsDoc?: ts.JSDoc[] }).jsDoc ?? [];
  return docs
    .map((d) => ts.getTextOfJSDocComment(d.comment) ?? '')
    .join('\n')
    .trim();
}

/** Declaration text without its leading JSDoc. */
function code(node: ts.Node, sf: ts.SourceFile): string {
  return sf.text.slice(node.getStart(sf, false), node.getEnd()).trim();
}

function exportedName(node: ts.Statement): string | null {
  const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  if (!mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) return null;
  if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isFunctionDeclaration(node)) return node.name?.text ?? null;
  if (ts.isVariableStatement(node)) return node.declarationList.declarations.map((d) => d.name.getText()).join(', ');
  return null;
}

const oneLine = (s: string) => s.replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|');

function eventTable(sf: ts.SourceFile, iface: string, direction: 'c2s' | 's2c'): string {
  const decl = sf.statements.find((s): s is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(s) && s.name.text === iface)!;
  const rows: string[] = [];
  for (const m of decl.members) {
    if (!ts.isPropertySignature(m) || !m.type || !ts.isFunctionTypeNode(m.type)) continue;
    const name = (m.name as ts.StringLiteral).text;
    const params = m.type.parameters;
    const ackParam = direction === 'c2s' ? params.find((p) => p.name.getText(sf) === 'ack') : undefined;
    const payload = params.filter((p) => p !== ackParam).map((p) => p.type?.getText(sf) ?? 'unknown');
    let ack = '—';
    if (ackParam?.type) {
      const t = ackParam.type;
      ack = ts.isFunctionTypeNode(t) ? (t.parameters[0]?.type?.getText(sf) ?? '—') : t.getText(sf).replace(/^AckFn<(.*)>$/s, 'Ack<$1>');
    }
    const cells = [`\`${name}\``, payload.length ? `\`${oneLine(payload.join(', '))}\`` : '—'];
    if (direction === 'c2s') cells.push(ack === '—' ? '—' : `\`${oneLine(ack)}\``);
    cells.push(oneLine(jsdoc(m)));
    rows.push(`| ${cells.join(' | ')} |`);
  }
  const head = direction === 'c2s' ? '| Event | Payload | Ack response | Description |\n|---|---|---|---|' : '| Event | Payload | Description |\n|---|---|---|';
  return `${head}\n${rows.join('\n')}`;
}

function typeSection(file: string, title: string): string {
  const sf = parse(file);
  const parts = [`### ${title} (\`${file}\`)`];
  for (const st of sf.statements) {
    const name = exportedName(st);
    if (!name) continue;
    const doc = jsdoc(st);
    parts.push(`#### \`${name}\`\n\n${doc ? `${doc}\n\n` : ''}\`\`\`ts\n${code(st, sf)}\n\`\`\``);
  }
  return parts.join('\n\n');
}

const protocol = parse('protocol.ts');

const md = `# 接字派對 Word Chain Party — Client/Server Protocol

> Generated from \`packages/shared/src\` by \`npm run gen:protocol\`. Do not edit by hand.
> Import the types directly in TypeScript clients: \`import type { ... } from '@wordparty/shared'\`.

## 1. Connection

- Transport: **Socket.IO v4** (WebSocket). Connect with \`socket.io-client\`:

  \`\`\`ts
  import { io, Socket } from 'socket.io-client';
  import type { ClientToServerEvents, ServerToClientEvents } from '@wordparty/shared';
  const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(SERVER_URL, { transports: ['websocket'] });
  \`\`\`

- All messages are JSON. Requests use Socket.IO acknowledgements:
  \`socket.emit('room:join', payload, (res) => …)\` or \`await socket.timeout(5000).emitWithAck('room:join', payload)\`.
- Every request ack is \`Ack<T>\` = \`{ ok: true, data }\` or \`{ ok: false, error: ErrorCode }\`.
  \`game:submit\` answers with \`SubmitResult\` and \`time:ping\` with \`TimeSync\`.
- Health check: \`GET /healthz\` → \`{ ok: true, rooms: number }\`.

## 2. The server is the only referee

The server owns all timers, word validation, scoring and elimination. Clients only send input
(\`game:submit\`, \`game:useItem\`, host controls) and render what the server sends.

- \`state:snapshot\` carries the **whole** public room state. It is sent every **100 ms** while the
  phase is \`COUNTDOWN\` or \`ROUND\`, and on every change otherwise. Just replace your state with it.
- All times are **server timestamps in ms** (\`deadline\`, \`turnDeadline\`, \`phaseEndsAt\`, …).
  Draw countdowns from them using a clock offset:
  1. send \`time:ping { t0: Date.now() }\`; on the ack, \`rtt = Date.now() − t0\`,
     \`offset = serverNow − (t0 + rtt / 2)\`;
  2. server time ≈ \`Date.now() + offset\`. Repeat a few times and keep the lowest-rtt sample.
  Each snapshot also includes \`serverNow\`.
- \`game:event\` messages are one-off notifications for animation (word accepted, BOOM, eliminated…).
  Never derive state from them; the next snapshot already contains the result.
- \`state:private\` goes only to its owner: items, Lock letters, shield/star status, personal deadline.

## 3. Typical flows

**TV / display**
1. \`room:create { role: 'display' }\` → \`JoinResult\` with \`code\` (e.g. \`PQ7K\`, show it and a QR code of the join URL).
2. Render \`state:snapshot\`. A display can use host controls (\`host:setup\`, \`host:start\`, \`host:kick\`, \`host:backToLobby\`).

**Phone / player**
1. \`room:join { code, name, avatar }\` → \`JoinResult\`. **Save \`code\` + \`token\`** (e.g. in localStorage).
2. The first player to join is the host (\`snapshot.hostId\`, \`players[].isHost\`).
3. In \`ROUND\`, send \`game:submit { word }\`; show \`SubmitResult.reason\` on failure.
   Bomb Pass: add \`targetId\` (or omit it for a random allowed target).
4. On disconnect, reconnect and send \`room:rejoin { code, token }\` within **60 s** to keep your seat,
   score and place in turn order. Joining a second socket with the same token kicks the first (\`room:kicked { reason: 'REPLACED' }\`).

**Game phases** — \`LOBBY → COUNTDOWN (3 s) → ROUND → ROUND_END (6 s) → COUNTDOWN … → FINAL\`.
A setup has 1–10 *stages* (mode + rounds). More than one stage is a tournament (錦標賽); scores add up across all rounds.

## 4. Limits

| Rule | Value |
|---|---|
| Players per room | 2–10 (displays do not count) |
| Room code | 4 characters from \`ABCDEFGHJKLMNPQRSTUVWXYZ23456789\` (no 0 O 1 I), case-insensitive |
| Nickname | 1–8 characters: letters (any language), digits, \`_\`, single spaces; unique in the room (case-insensitive) |
| Avatar | integer 0–11 |
| Reconnect grace | 60 s, then the seat is released (host passes to the next player) |
| Idle room | destroyed after 10 min with no client messages (\`room:closed { reason: 'IDLE' }\`) |
| Rate limit | 10 messages/s per connection, burst 20; extra messages get \`RATE_LIMITED\`; persistent flooding disconnects |
| Max message size | 4 KB |
| Joining | only in \`LOBBY\` or \`FINAL\`; mid-game only \`room:rejoin\` works |

## 5. Client → Server

${eventTable(protocol, 'ClientToServerEvents', 'c2s')}

## 6. Server → Client

${eventTable(protocol, 'ServerToClientEvents', 's2c')}

## 7. Modes at a glance

| Mode | Who may answer | Required start | Scoring | Ends when |
|---|---|---|---|---|
| \`flash\` 閃電搶答 | everyone, any time | \`startLetter\` | word length; each word scores once (first come) | time up |
| \`precise\` 精準接龍 | everyone, own chain | own lane \`requiredLetter\` | length × combo (×1.5 at 3, ×2 at 6); error −2; 3 errors = out | time up / all out |
| \`bomb\` 炸彈傳遞 | the holder | last letter of \`currentWord\` | 2 per pass + 10 per player outlasted | one player left |
| \`lastStand\` 末位淘汰 | every living player, own words | heat \`startLetter\` | letters + 10 per player outlasted; lowest heat score is out | one player left |
| \`teamRelay\` 組隊接力 | \`activePlayerId\` | \`requiredLetter\` | 5 per word; winning team +20 each | team reaches target / time up |
| \`coopChain\` 合作長龍 | anyone except \`lastPlayerId\` | \`requiredLetter\` | 3 per word; all +5 per milestone, +20 on completion | target reached / time up |
| \`trapChain\` 陷阱接龍 | \`activePlayerId\` | \`requiredLetter\` | word length; trap −3 and −1 life; timeout −1 life; +10 per player outlasted | one player left / time up |

Modifiers (\`bannedLetters\`, \`minLength\`, \`itemsEnabled\`) apply to every mode.

## 8. Types

${typeSection('errors.ts', 'Errors')}

${typeSection('protocol.ts', 'Messages')}

${typeSection('state.ts', 'State')}

${typeSection('modes.ts', 'Modes and setup')}

${typeSection('items.ts', 'Items')}

${typeSection('constants.ts', 'Constants')}
`;

writeFileSync(OUT, md);
console.log(`wrote ${OUT}`);
