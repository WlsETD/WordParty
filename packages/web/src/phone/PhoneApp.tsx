import { useState, type FormEvent, type ReactNode } from 'react';
import type { ItemType, ModePublicState, PlayerPublic, PrivateState, RoomSnapshot, StageConfig } from '@wordparty/shared';
import { useGame, type ClientSubmit, type Game } from '../lib/useGame';
import {
  AVATARS,
  ITEM_LABEL,
  MODE_LABEL,
  REASON_TEXT,
  errorText,
  nameOf,
  ruleText,
  seconds,
  totalOf,
  useNow,
} from '../lib/format';

/** The phone controller. One screen per game phase; the server decides what is allowed. */
export function PhoneApp() {
  const g = useGame('phone', false);
  const s = g.snapshot;
  const me = s?.players.find((p) => p.id === g.playerId) ?? null;

  if (!s || !g.joined || !me) {
    return (
      <Shell g={g}>
        <JoinScreen g={g} />
      </Shell>
    );
  }

  return (
    <Shell g={g}>
      {s.phase === 'LOBBY' && <WaitScreen g={g} s={s} me={me} />}
      {s.phase === 'COUNTDOWN' && <CountdownScreen g={g} s={s} />}
      {s.phase === 'ROUND' &&
        (me.eliminated ? <SpectatorScreen g={g} s={s} me={me} /> : <PlayScreen g={g} s={s} me={me} />)}
      {s.phase === 'ROUND_END' && <RoundEndScreen s={s} me={me} />}
      {s.phase === 'FINAL' && <FinalScreen g={g} s={s} me={me} />}
    </Shell>
  );
}

function Shell({ g, children }: { g: Game; children: ReactNode }) {
  return (
    <div className="phone">
      {g.conn !== 'online' && (
        <div className="banner warn">{g.conn === 'connecting' ? '連線中…' : '連線中斷，重新連線中…'}</div>
      )}
      {g.notice && (
        <button className="banner info" onClick={g.clearNotice}>
          {g.notice} ✕
        </button>
      )}
      {children}
    </div>
  );
}

function AvatarPicker({ value, onChange }: { value: number; onChange: (a: number) => void }) {
  return (
    <div className="avatars">
      {AVATARS.map((a, i) => (
        <button
          type="button"
          key={i}
          className={`av ${i === value ? 'on' : ''}`}
          onClick={() => onChange(i)}
          aria-label={`角色 ${i + 1}`}
        >
          {a}
        </button>
      ))}
    </div>
  );
}

function JoinScreen({ g }: { g: Game }) {
  const [code, setCode] = useState(
    () => new URLSearchParams(location.search).get('code')?.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) ?? '',
  );
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErr(null);
    const res = await g.join(code, name.trim(), avatar);
    setBusy(false);
    if (!res.ok) setErr(errorText(res));
  };

  return (
    <form className="stack join" onSubmit={submit}>
      <h1 className="logo">接字派對</h1>
      <label className="field">
        <span>房間碼</span>
        <input
          className="code-input"
          value={code}
          maxLength={4}
          autoCapitalize="characters"
          autoComplete="off"
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z2-9]/g, ''))}
          placeholder="PQ7K"
        />
      </label>
      <label className="field">
        <span>暱稱（1–8 字）</span>
        <input
          value={name}
          maxLength={8}
          autoComplete="nickname"
          onChange={(e) => setName(e.target.value)}
          placeholder="你的暱稱"
        />
      </label>
      <div className="field">
        <span>選一個角色</span>
        <AvatarPicker value={avatar} onChange={setAvatar} />
      </div>
      {err && <div className="err">{err}</div>}
      <button className="btn primary" disabled={busy || code.length !== 4 || !name.trim()}>
        加入派對！
      </button>
    </form>
  );
}

function PlayerStrip({ players }: { players: PlayerPublic[] }) {
  return (
    <div className="strip">
      {players.map((p) => (
        <div key={p.id} className={`strip-item ${p.connected ? '' : 'off'}`}>
          <span className="strip-av">{AVATARS[p.avatar]}</span>
          <small>
            {p.name}
            {p.isHost ? ' 👑' : ''}
          </small>
        </div>
      ))}
    </div>
  );
}

function WaitScreen({ g, s, me }: { g: Game; s: RoomSnapshot; me: PlayerPublic }) {
  const [err, setErr] = useState<string | null>(null);
  const others = s.players.length;

  const start = async () => {
    const r = await g.start();
    if (!r.ok) setErr(errorText(r));
  };
  const pickAvatar = async (a: number) => {
    const r = await g.setAvatar(a);
    if (!r.ok) setErr(errorText(r));
  };

  return (
    <div className="stack center">
      <div className="pill">已加入房間 {s.code}</div>
      <div className="avatar-big">{AVATARS[me.avatar]}</div>
      <div className="name">
        {me.name}
        {me.isHost ? ' 👑' : ''}
      </div>
      <p className="muted">
        {me.isHost
          ? others >= 2
            ? '你是房主，準備好就按開始！'
            : '等待其他玩家加入（至少 2 人）'
          : '等待主持人開始…'}
      </p>
      {me.isHost && (
        <button className="btn primary" disabled={others < 2} onClick={start}>
          開始！
        </button>
      )}
      <AvatarPicker value={me.avatar} onChange={pickAvatar} />
      <PlayerStrip players={s.players} />
      {err && <div className="err">{err}</div>}
      <button className="btn ghost" onClick={() => g.leave()}>
        離開房間
      </button>
    </div>
  );
}

function CountdownScreen({ g, s }: { g: Game; s: RoomSnapshot }) {
  const now = useNow(g.now);
  const sec = Math.ceil(((s.phaseEndsAt ?? now) - now) / 1000);
  return (
    <div className="stack center">
      <div className="countdown" key={sec}>
        {sec > 0 ? sec : 'GO!'}
      </div>
      <p className="muted">看向電視！</p>
    </div>
  );
}

function TimeBar({ left, total, fraction }: { left: number | null; total: number; fraction?: number }) {
  if (fraction !== undefined) {
    return (
      <div className="timebar">
        <div className="fill fuse" style={{ width: `${fraction * 100}%` }} />
        <span>🧨 引信</span>
      </div>
    );
  }
  if (left === null) return null;
  const pct = Math.max(0, Math.min(1, left / total)) * 100;
  return (
    <div className="timebar">
      <div className="fill" style={{ width: `${pct}%` }} />
      <span>{seconds(left)}s</span>
    </div>
  );
}

interface Prompt {
  title: string;
  letter?: string;
  canType: boolean;
  /** Server timestamp when this prompt's timer runs out, or null. */
  until: number | null;
  /** Bomb only: remaining fuse fraction. */
  fraction?: number;
  sub?: string;
}

/** What this player should be doing right now, per mode. */
function promptFor(m: ModePublicState, me: PlayerPublic, s: RoomSnapshot, priv: PrivateState | null): Prompt {
  const name = (id: string | null) => nameOf(s.players, id);
  const personal = priv?.personalDeadline ?? null;
  switch (m.mode) {
    case 'flash':
      return {
        title: '用這個字母開頭！先到先得',
        letter: m.startLetter,
        canType: true,
        until: personal ?? m.deadline,
        sub: `你已拿 ${m.grabbed.filter((w) => w.playerId === me.id).length} 字`,
      };
    case 'precise': {
      const lane = m.lanes.find((l) => l.playerId === me.id);
      if (!lane || lane.out) return { title: '你已出局', canType: false, until: null };
      return {
        title: '接你自己的龍',
        letter: lane.requiredLetter,
        canType: true,
        until: personal ?? m.deadline,
        sub: `連擊 ×${lane.combo} · 錯誤 ${lane.errors}/${m.maxErrors}`,
      };
    }
    case 'bomb':
      if (m.pausedUntil !== null) return { title: '💥 爆炸！下一顆準備中…', canType: false, until: null, fraction: m.fuseFraction };
      if (m.holderId === me.id)
        return { title: '接招！', letter: m.requiredLetter, canType: true, until: null, fraction: m.fuseFraction, sub: '接完會自動傳給別人' };
      return { title: `炸彈在 ${name(m.holderId)} 手上`, canType: false, until: null, fraction: m.fuseFraction };
    case 'lastStand':
      if (m.heatDeadline === null) return { title: `第 ${m.heat} 回合結束，準備下一輪…`, canType: false, until: null };
      return {
        title: '用這個字母開頭！',
        letter: m.startLetter,
        canType: true,
        until: personal ?? m.heatDeadline,
        sub: `第 ${m.heat} 回合 · 只跟自己比`,
      };
    case 'teamRelay': {
      const mine = m.activePlayerId === me.id;
      return {
        title: mine ? '輪到你！' : `等待 ${name(m.activePlayerId)}（${m.activeTeam} 隊）`,
        letter: m.requiredLetter,
        canType: mine,
        until: m.turnDeadline,
        sub: `A ${m.teams.A.score} : ${m.teams.B.score} B · 先到 ${m.targetScore} 分`,
      };
    }
    case 'coopChain': {
      const blocked = m.lastPlayerId === me.id;
      return {
        title: blocked ? '等別人接一下！' : '大家一起接龍',
        letter: m.requiredLetter,
        canType: !blocked,
        until: m.deadline,
        sub: `${m.count} / ${m.target}`,
      };
    }
    case 'trapChain': {
      const mine = m.activePlayerId === me.id;
      return {
        title: mine ? '輪到你！小心陷阱' : `等待 ${name(m.activePlayerId)}`,
        letter: m.requiredLetter,
        canType: mine,
        until: m.turnDeadline,
        sub: m.traps.map(ruleText).join(' · '),
      };
    }
  }
}

function PlayScreen({ g, s, me }: { g: Game; s: RoomSnapshot; me: PlayerPublic }) {
  const now = useNow(g.now);
  const m = s.modeState;
  const stage: StageConfig | undefined = s.setup.stages[s.stageIndex];
  const [word, setWord] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  if (!m || !stage) return <div className="center muted">等待回合開始…</div>;
  const prompt = promptFor(m, me, s, g.priv);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const w = word.trim();
    if (!w || busy || !prompt.canType) return;
    setBusy(true);
    const r: ClientSubmit = await g.submit(w);
    setBusy(false);
    if (r.ok) {
      setFeedback({ ok: true, text: `+${r.points}  ${r.word.toUpperCase()}` });
      setWord('');
    } else {
      const penalty = 'penalty' in r && r.penalty ? `（−${r.penalty}）` : '';
      setFeedback({ ok: false, text: REASON_TEXT[r.reason] + penalty });
    }
  };

  return (
    <div className="stack">
      <header className="row between">
        <span className="chip">{MODE_LABEL[stage.mode].name}</span>
        <span className="muted small">
          第 {s.roundInStage}/{stage.rounds} 回合
        </span>
        <span className="score">{me.score}</span>
      </header>
      <TimeBar
        left={prompt.until !== null ? prompt.until - now : null}
        total={totalOf(stage)}
        fraction={prompt.fraction}
      />
      <section className="card prompt">
        <div className="muted">{prompt.title}</div>
        {prompt.letter && <div className="tile big">{prompt.letter.toUpperCase()}</div>}
        {prompt.sub && <div className="muted small">{prompt.sub}</div>}
      </section>
      {prompt.canType && (
        <form className="card" onSubmit={send}>
          <input
            className="word-input"
            value={word}
            onChange={(e) => {
              setWord(e.target.value.toLowerCase().replace(/[^a-z]/g, ''));
              setFeedback(null);
            }}
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            maxLength={45}
            placeholder={prompt.letter ? `${prompt.letter}…` : ''}
          />
          <button className="btn primary" disabled={busy || !word}>
            送出 →
          </button>
        </form>
      )}
      {feedback && <div className={feedback.ok ? 'ok' : 'err'}>{feedback.text}</div>}
      <ItemPanel g={g} s={s} me={me} />
    </div>
  );
}

function SpectatorScreen({ g, s, me }: { g: Game; s: RoomSnapshot; me: PlayerPublic }) {
  return (
    <div className="stack">
      <div className="card out">
        <h2>你被淘汰了…</h2>
        <p>但還能搗蛋！</p>
      </div>
      <ItemPanel g={g} s={s} me={me} />
    </div>
  );
}

/** Items the player holds this round. Hidden when items are off. */
function ItemPanel({ g, s, me }: { g: Game; s: RoomSnapshot; me: PlayerPublic }) {
  const now = useNow(g.now, 250);
  const [target, setTarget] = useState<string | null>(null);
  const [letter, setLetter] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const p = g.priv;
  if (!p || p.items.length === 0) return null;

  const others = s.players.filter((x) => x.id !== me.id && !x.eliminated);

  const activate = async (item: ItemType) => {
    const needsTarget = item === 'hourglass' || item === 'lock';
    if (needsTarget && !target) return setMsg('先選一位目標');
    if (item === 'lock' && !/^[a-z]$/.test(letter)) return setMsg('輸入要封鎖的字母（a–z）');
    const r = await g.useItem({
      item,
      ...(needsTarget ? { targetId: target! } : {}),
      ...(item === 'lock' ? { letter } : {}),
    });
    setMsg(r.ok ? `${ITEM_LABEL[item].name} 已使用` : errorText(r));
  };

  return (
    <section className="card items">
      <div className="row between">
        <span className="muted small">道具</span>
        {p.shieldActive && <span className="tag">🛡️ 護盾生效中</span>}
        {p.doubleActive && <span className="tag">⭐ 下一字 ×2</span>}
      </div>
      {others.length > 0 && (
        <div className="chips">
          {others.map((o) => (
            <button key={o.id} className={`pick ${target === o.id ? 'on' : ''}`} onClick={() => setTarget(o.id)}>
              {AVATARS[o.avatar]} {o.name}
            </button>
          ))}
        </div>
      )}
      <input
        className="letter"
        value={letter}
        maxLength={1}
        autoComplete="off"
        placeholder="封鎖字母"
        onChange={(e) => setLetter(e.target.value.toLowerCase().replace(/[^a-z]/g, ''))}
      />
      <div className="grid2">
        {p.items.map((it) => {
          const L = ITEM_LABEL[it.type];
          const cool = it.cooldownUntil - now;
          const disabled = it.count <= 0 || cool > 0;
          return (
            <button key={it.type} className="item" disabled={disabled} onClick={() => activate(it.type)}>
              <span className="item-icon">{L.icon}</span>
              <b>{L.name}</b>
              <small>{cool > 0 ? `冷卻 ${seconds(cool)} 秒` : L.desc}</small>
              <em>×{it.count}</em>
            </button>
          );
        })}
      </div>
      {msg && <div className="small muted">{msg}</div>}
    </section>
  );
}

function RoundEndScreen({ s, me }: { s: RoomSnapshot; me: PlayerPublic }) {
  const r = s.lastRound;
  if (!r) return null;
  const rank = r.scores.findIndex((x) => x.playerId === me.id);
  const mine = rank >= 0 ? r.scores[rank] : undefined;
  return (
    <div className="stack center">
      <h2>第 {s.roundNumber} 回合結束</h2>
      <div className="big-score">+{mine?.points ?? 0}</div>
      <p>
        {rank >= 0 ? `第 ${rank + 1} 名` : ''}
        {r.mvpId === me.id ? ' · MVP 👑' : ''}
      </p>
      {mine?.longestWord && <p className="muted">最長單字 {mine.longestWord.toUpperCase()}</p>}
      <p className="muted">總分 {me.score}</p>
      <p className="muted">下一回合即將開始…</p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="card stat">
      <small className="muted">{label}</small>
      <b>{value}</b>
    </div>
  );
}

function FinalScreen({ g, s, me }: { g: Game; s: RoomSnapshot; me: PlayerPublic }) {
  const [err, setErr] = useState<string | null>(null);
  const row = s.final?.standings.find((x) => x.playerId === me.id);
  const again = async () => {
    const r = await g.start();
    if (!r.ok) setErr(errorText(r));
  };
  return (
    <div className="stack center">
      <h2>🏆 遊戲結束</h2>
      {row && (
        <>
          <div className="big-score">第 {row.rank} 名</div>
          <div className="muted">{row.score} 分</div>
          <div className="grid2">
            <Stat label="最長單字" value={row.stats.longestWord?.toUpperCase() ?? '—'} />
            <Stat label="最高連擊" value={row.stats.bestCombo} />
            <Stat label="成功單字" value={row.stats.wordsAccepted} />
            <Stat label="道具使用" value={row.stats.itemsUsed} />
          </div>
        </>
      )}
      {me.isHost ? (
        <button className="btn primary" onClick={again}>
          再玩一局
        </button>
      ) : (
        <p className="muted">等待房主開始下一局…</p>
      )}
      {err && <div className="err">{err}</div>}
      <button className="btn ghost" onClick={() => g.leave()}>
        離開房間
      </button>
    </div>
  );
}
