import { useState, type ReactNode } from 'react';
import {
  MODE_IDS,
  type GameSetupInput,
  type ModeId,
  type ModePublicState,
  type RoomSnapshot,
  type StageInput,
} from '@wordparty/shared';
import { useGame, type Game, type TimedEvent } from '../lib/useGame';
import {
  AVATARS,
  MODE_LABEL,
  errorText,
  eventText,
  nameOf,
  ruleText,
  seconds,
  totalOf,
  useNow,
} from '../lib/format';

/** The shared screen (TV or laptop). It opens its own room and shows the whole game. */
export function TvApp() {
  const g = useGame('tv', true);
  const now = useNow(g.now);
  const s = g.snapshot;
  return (
    <div className="tv">
      {g.notice && (
        <button className="banner info" onClick={g.clearNotice}>
          {g.notice} ✕
        </button>
      )}
      {g.conn !== 'online' && <div className="banner warn">連線中…</div>}
      {!s ? (
        <div className="tv-center big-text">接字派對 · 連線中…</div>
      ) : s.phase === 'LOBBY' ? (
        <TvLobby g={g} s={s} />
      ) : s.phase === 'COUNTDOWN' ? (
        <TvCountdown s={s} now={now} />
      ) : s.phase === 'ROUND' ? (
        <TvRound s={s} now={now} events={g.events} />
      ) : s.phase === 'ROUND_END' ? (
        <TvRoundEnd s={s} />
      ) : (
        <TvFinal g={g} s={s} />
      )}
    </div>
  );
}

function TvLobby({ g, s }: { g: Game; s: RoomSnapshot }) {
  const [pick, setPick] = useState<ModeId | 'tournament'>('tournament');
  const [rounds, setRounds] = useState(1);
  const [items, setItems] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const setup = (): GameSetupInput => ({
    stages:
      pick === 'tournament'
        ? MODE_IDS.map((mode) => ({ mode, rounds: 1 }) as StageInput)
        : [{ mode: pick, rounds } as StageInput],
    modifiers: { itemsEnabled: items },
  });

  const start = async () => {
    setBusy(true);
    setErr(null);
    const c = await g.configure(setup());
    if (!c.ok) {
      setErr(errorText(c));
      setBusy(false);
      return;
    }
    const r = await g.start();
    if (!r.ok) setErr(errorText(r));
    setBusy(false);
  };

  return (
    <div className="tv-lobby">
      <section className="tv-left">
        <div className="kicker">房間碼</div>
        <div className="code">
          {s.code.split('').map((c, i) => (
            <span key={i} className="tile">
              {c}
            </span>
          ))}
        </div>
        <div className="join-hint">
          用手機開瀏覽器，前往 <b>{location.host}</b> 輸入房間碼
        </div>
        <div className="url">{`${location.origin}/?code=${s.code}`}</div>
        <div className="kicker">玩家 {s.players.length} / 10</div>
        <div className="player-grid">
          {s.players.map((p) => (
            <div key={p.id} className={`player-card ${p.connected ? '' : 'off'}`}>
              <span className="pc-av">{AVATARS[p.avatar]}</span>
              <span className="pc-name">
                {p.name}
                {p.isHost ? ' 👑' : ''}
              </span>
              {!p.connected && <span className="pc-off">離線</span>}
              {!p.isHost && (
                <button className="pc-kick" onClick={() => void g.kick(p.id)} aria-label={`移出 ${p.name}`}>
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
        {s.players.length === 0 && <p className="muted">等待玩家加入…</p>}
      </section>

      <aside className="tv-right card">
        <h2>選擇模式</h2>
        <div className="mode-grid">
          <button className={`mode-btn ${pick === 'tournament' ? 'on' : ''}`} onClick={() => setPick('tournament')}>
            🏆 錦標賽
            <small>七種模式各一回合，總分累計</small>
          </button>
          {MODE_IDS.map((m) => (
            <button key={m} className={`mode-btn ${pick === m ? 'on' : ''}`} onClick={() => setPick(m)}>
              {MODE_LABEL[m].name}
              <small>{MODE_LABEL[m].en}</small>
            </button>
          ))}
        </div>
        {pick !== 'tournament' && (
          <label className="field row">
            <span>回合數</span>
            <select value={rounds} onChange={(e) => setRounds(Number(e.target.value))}>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="check">
          <input type="checkbox" checked={items} onChange={(e) => setItems(e.target.checked)} /> 開啟道具
        </label>
        <button className="btn primary big" disabled={busy || s.players.length < 2} onClick={start}>
          開始！
        </button>
        {s.players.length < 2 && <p className="muted">至少需要 2 位玩家</p>}
        {err && <div className="err">{err}</div>}
      </aside>
    </div>
  );
}

function TvCountdown({ s, now }: { s: RoomSnapshot; now: number }) {
  const sec = Math.ceil(((s.phaseEndsAt ?? now) - now) / 1000);
  return (
    <div className="tv-center">
      <div className="countdown tv" key={sec}>
        {sec > 0 ? sec : 'GO!'}
      </div>
      <div className="big-text">看向你的手機！</div>
    </div>
  );
}

function Tile({ ch, xl }: { ch: string; xl?: boolean }) {
  return <span className={`tile ${xl ? 'xl' : ''}`}>{ch.toUpperCase()}</span>;
}

/** A word with its last letter highlighted, since that is the letter the next word must start with. */
function WordTail({ word, big }: { word: string; big?: boolean }) {
  return (
    <span className={`word ${big ? 'big' : ''}`}>
      {word.slice(0, -1).toUpperCase()}
      <mark>{word.slice(-1).toUpperCase()}</mark>
    </span>
  );
}

function WordChip({
  word,
  who,
  pts,
  fresh,
  team,
}: {
  word: string;
  who: string;
  pts: number;
  fresh?: boolean;
  team?: string;
}) {
  return (
    <div className={`chip-word ${fresh ? 'fresh' : ''} ${team ? `team-${team}` : ''}`}>
      <WordTail word={word} />
      <small>
        {who} +{pts}
      </small>
    </div>
  );
}

function TvRound({ s, now, events }: { s: RoomSnapshot; now: number; events: TimedEvent[] }) {
  const m = s.modeState;
  const stage = s.setup.stages[s.stageIndex];
  if (!m || !stage) return null;
  const name = (id: string | null) => nameOf(s.players, id);

  // Round-level clock, when the mode has one. Bomb uses the fuse instead.
  const roundLeft: number | null =
    'deadline' in m ? m.deadline - now : m.mode === 'lastStand' && m.heatDeadline !== null ? m.heatDeadline - now : null;
  const total = totalOf(stage);
  const latest = [...events].reverse().find((e) => now - e.at < 4000);
  const text = latest ? eventText(latest.event, s.players) : null;
  const board = [...s.players].sort((a, b) => b.score - a.score);

  return (
    <div className="tv-round">
      <header className="tv-top">
        <span className="chip big">{MODE_LABEL[stage.mode].name}</span>
        <span className="muted">
          第 {s.roundNumber} 回合 · 本段 {s.roundInStage}/{stage.rounds}
        </span>
        <span className="clock">{roundLeft !== null ? seconds(roundLeft) : '🧨'}</span>
      </header>
      {roundLeft !== null && (
        <div className="timebar tv">
          <div className="fill" style={{ width: `${Math.max(0, Math.min(1, roundLeft / total)) * 100}%` }} />
        </div>
      )}
      <div className="tv-body">
        <div className="stage">
          <ModeView m={m} s={s} name={name} now={now} />
        </div>
        <aside className="board">
          <div className="kicker">總分</div>
          {board.map((p, i) => (
            <div key={p.id} className={`board-row ${p.eliminated ? 'out' : ''}`}>
              <span className="rank">{i + 1}</span>
              <span className="pc-av">{AVATARS[p.avatar]}</span>
              <span className="board-name">{p.name}</span>
              <b>{p.score}</b>
            </div>
          ))}
        </aside>
      </div>
      <footer className="ticker">{text ?? ' '}</footer>
    </div>
  );
}

function ModeView({
  m,
  s,
  name,
  now,
}: {
  m: ModePublicState;
  s: RoomSnapshot;
  name: (id: string | null) => string;
  now: number;
}): ReactNode {
  switch (m.mode) {
    case 'flash':
      return (
        <div className="mv">
          <Tile ch={m.startLetter} xl />
          <p className="prompt-line">用這個字母開頭！每個字只能得分一次</p>
          <div className="chips">
            {m.grabbed
              .slice(-12)
              .reverse()
              .map((w, i) => (
                <WordChip key={`${w.at}-${w.word}`} word={w.word} who={name(w.playerId)} pts={w.points} fresh={i === 0} />
              ))}
          </div>
        </div>
      );

    case 'precise': {
      const lanes = [...m.lanes].sort((a, b) => b.score - a.score);
      return (
        <div className="mv lanes">
          {lanes.map((l) => (
            <div key={l.playerId} className={`lane ${l.out ? 'out' : ''}`}>
              <span className="lane-name">{name(l.playerId)}</span>
              <WordTail word={l.lastWord} />
              <span className="flame">
                {'🔥'.repeat(l.flameTier)}
                {l.combo > 1 ? ` ×${l.combo}` : ''}
              </span>
              <span className="errs">
                {l.out ? '💥 出局' : '✕'.repeat(l.errors) + '○'.repeat(Math.max(0, m.maxErrors - l.errors))}
              </span>
              <b>{l.score}</b>
            </div>
          ))}
        </div>
      );
    }

    case 'bomb': {
      const boom = m.lastExplosion && now - m.lastExplosion.at < 1500 ? m.lastExplosion : null;
      return (
        <div className="mv bomb">
          <div className="holder">{m.holderId ? `${name(m.holderId)} 拿著炸彈` : '炸彈爆炸中…'}</div>
          <WordTail word={m.currentWord} big />
          <div className="fuse">
            <div className={`fill fuse-${m.fuseStage}`} style={{ width: `${m.fuseFraction * 100}%` }} />
          </div>
          <div className="next">
            下一個：<Tile ch={m.requiredLetter} />
          </div>
          <div className="lives">
            {Object.entries(m.lives).map(([id, n]) => (
              <span key={id} className={n <= 0 ? 'dead' : ''}>
                {name(id)} {n > 0 ? '♥'.repeat(n) : '出局'}
              </span>
            ))}
          </div>
          {boom && <div className="boom">BOOM!</div>}
        </div>
      );
    }

    case 'lastStand': {
      const alive = m.alive
        .map((id) => ({ id, score: m.heatScores[id] ?? 0 }))
        .sort((a, b) => b.score - a.score);
      return (
        <div className="mv">
          <div className="kicker">第 {m.heat} 回合</div>
          <Tile ch={m.startLetter} />
          <div className="rank-list">
            {alive.map((a, i) => (
              <div key={a.id} className={`rank-row ${a.id === m.dangerId ? 'danger' : ''}`}>
                <span>{i + 1}</span>
                <span>{name(a.id)}</span>
                {a.id === m.dangerId && <em>危險區</em>}
                <b>{a.score}</b>
              </div>
            ))}
          </div>
          {m.eliminatedOrder.length > 0 && (
            <div className="out-list">出局：{m.eliminatedOrder.map((id) => name(id)).join('、')}</div>
          )}
        </div>
      );
    }

    case 'teamRelay':
      return (
        <div className="mv teams">
          {(['A', 'B'] as const).map((t) => {
            const team = m.teams[t];
            return (
              <div key={t} className={`team team-${t} ${m.activeTeam === t ? 'on' : ''}`}>
                <div className="team-head">{t === 'A' ? '● 洋紅隊' : '▲ 青綠隊'}</div>
                <div className="team-score">
                  {team.score}
                  <small> / {m.targetScore}</small>
                </div>
                <div className="members">
                  {team.members.map((id) => (
                    <span key={id} className={m.activePlayerId === id ? 'active' : ''}>
                      {name(id)}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
          <div className="relay-center">
            <div className="chain">
              {m.chain.slice(-8).map((c, i, arr) => (
                <WordChip
                  key={`${c.at}-${c.word}`}
                  word={c.word}
                  who={name(c.playerId)}
                  pts={c.points}
                  fresh={i === arr.length - 1}
                  team={c.team}
                />
              ))}
            </div>
            <WordTail word={m.currentWord} big />
            <div className="next">
              下一個：<Tile ch={m.requiredLetter} />
              <span className="muted"> 由 {name(m.activePlayerId)} 作答</span>
            </div>
          </div>
        </div>
      );

    case 'coopChain':
      return (
        <div className="mv coop">
          <div className="counter">
            {m.count}
            <small> / {m.target}</small>
          </div>
          <div className="progress">
            <div className="fill" style={{ width: `${Math.min(100, (m.count / m.target) * 100)}%` }} />
            {m.milestones.map((x) => (
              <i key={x} style={{ left: `${(x / m.target) * 100}%` }}>
                ★
              </i>
            ))}
          </div>
          <div className="chain">
            {m.chain.slice(-12).map((c) => (
              <WordChip key={`${c.at}-${c.word}`} word={c.word} who={name(c.playerId)} pts={c.points} />
            ))}
          </div>
          <div className="next">
            下一個：<Tile ch={m.requiredLetter} />
          </div>
          <div className="contrib">
            {Object.entries(m.contributions).map(([id, n]) => (
              <span key={id}>
                {name(id)} ×{n}
              </span>
            ))}
          </div>
          {m.completed && <div className="boom">長龍完成！🏆</div>}
        </div>
      );

    case 'trapChain':
      return (
        <div className="mv trap">
          <div className="holder">{m.activePlayerId ? `${name(m.activePlayerId)} 作答中` : ''}</div>
          <WordTail word={m.currentWord} big />
          <div className="next">
            下一個：<Tile ch={m.requiredLetter} />
          </div>
          <div className="traps">
            {m.traps.map((t, i) => (
              <div key={i} className="trap">
                ⚠️ {ruleText(t)}
              </div>
            ))}
          </div>
          <div className="lives">
            {Object.entries(m.lives).map(([id, n]) => (
              <span key={id} className={n <= 0 ? 'dead' : ''}>
                {name(id)} {n > 0 ? '♥'.repeat(n) : '出局'}
              </span>
            ))}
          </div>
        </div>
      );
  }
}

function TvRoundEnd({ s }: { s: RoomSnapshot }) {
  const r = s.lastRound;
  if (!r) return null;
  const top = Math.max(1, ...r.scores.map((x) => x.points));
  const mvp = r.mvpId ? r.scores.find((x) => x.playerId === r.mvpId) : undefined;
  return (
    <div className="tv-end">
      <h1>第 {s.roundNumber} 回合結算</h1>
      <div className="bars">
        {r.scores.map((x, i) => (
          <div key={x.playerId} className="bar-row">
            <span className="rank">{i + 1}</span>
            <span className="pc-av">{AVATARS[s.players.find((p) => p.id === x.playerId)?.avatar ?? 0]}</span>
            <span className="bar-name">{nameOf(s.players, x.playerId)}</span>
            <div className="bar">
              <div className="fill" style={{ width: `${(Math.max(0, x.points) / top) * 100}%` }} />
            </div>
            <b>+{x.points}</b>
          </div>
        ))}
      </div>
      {mvp && (
        <div className="mvp">
          MVP 👑 {nameOf(s.players, mvp.playerId)}
          {mvp.longestWord ? `　最長單字 ${mvp.longestWord.toUpperCase()}` : ''}
        </div>
      )}
      <p className="muted">下一回合即將開始…</p>
    </div>
  );
}

function TvFinal({ g, s }: { g: Game; s: RoomSnapshot }) {
  const standings = s.final?.standings ?? [];
  return (
    <div className="tv-final">
      <h1>🏆 最終排名</h1>
      <ol className="standings">
        {standings.map((row) => {
          const p = s.players.find((x) => x.id === row.playerId);
          return (
            <li key={row.playerId} className={row.rank === 1 ? 'gold' : ''}>
              <span className="rank">{row.rank}</span>
              <span className="pc-av">{p ? AVATARS[p.avatar] : '👤'}</span>
              <span className="board-name">{p?.name ?? '（已離開）'}</span>
              <b>{row.score}</b>
            </li>
          );
        })}
      </ol>
      <div className="row">
        <button className="btn primary" onClick={() => void g.start()}>
          再玩一局
        </button>
        <button className="btn ghost" onClick={() => void g.backToLobby()}>
          回大廳
        </button>
      </div>
    </div>
  );
}
