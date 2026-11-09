import { describe, expect, it } from 'vitest';
import { EngineHarness, findWord } from '../../helpers.js';

const setup = (over: Record<string, number> = {}) => ({
  stages: [{ mode: 'teamRelay' as const, config: { turnMs: 5000, targetScore: 3, roundMs: 120_000, ...over } }],
});

function answer(h: EngineHarness, used: string[] = []) {
  const st = h.state('teamRelay');
  const w = findWord(h.dict, st.requiredLetter, { used: [...used, st.currentWord, ...st.chain.map((c) => c.word)], minLength: 4 });
  used.push(w);
  return { player: st.activePlayerId!, team: st.activeTeam, res: h.submit(st.activePlayerId!, w) };
}

describe('Team Relay 組隊接力', () => {
  it('splits players into two balanced teams', () => {
    const h = new EngineHarness(['A', 'B', 'C', 'D', 'E']).startGame(setup());
    const { teams } = h.state('teamRelay');
    expect(teams.A.members.length + teams.B.members.length).toBe(5);
    expect(Math.abs(teams.A.members.length - teams.B.members.length)).toBeLessThanOrEqual(1);
    for (const p of teams.A.members) expect(h.engine.playerStatus(p).team).toBe('A');
  });

  it('teams alternate, members rotate, and only the active player may answer', () => {
    const h = new EngineHarness(['A', 'B', 'C', 'D']).startGame(setup({ targetScore: 10 }));
    const st = h.state('teamRelay');
    const notActive = ['A', 'B', 'C', 'D'].find((p) => p !== st.activePlayerId)!;
    expect(h.submit(notActive, 'anything')).toEqual({ ok: false, reason: 'NOT_YOUR_TURN' });

    const turns = [];
    for (let i = 0; i < 4; i++) {
      const t = answer(h);
      expect(t.res).toMatchObject({ ok: true, points: 5 });
      turns.push(t);
    }
    expect(turns.map((t) => t.team)).toEqual([turns[0].team, turns[1].team, turns[0].team, turns[1].team]);
    expect(turns[0].team).not.toBe(turns[1].team);
    // Each team's two members took one turn each.
    expect(turns[0].player).not.toBe(turns[2].player);
    expect(turns[1].player).not.toBe(turns[3].player);
    const s = h.state('teamRelay');
    expect(s.teams.A.score).toBe(2);
    expect(s.teams.B.score).toBe(2);
    expect(s.chain).toHaveLength(4);
  });

  it('a timeout passes the turn to the other team without a point', () => {
    const h = new EngineHarness(['A', 'B']).startGame(setup());
    const first = h.state('teamRelay');
    h.advance(5000);
    const next = h.state('teamRelay');
    expect(next.activeTeam).not.toBe(first.activeTeam);
    expect(next.requiredLetter).toBe(first.requiredLetter);
    expect(h.eventsOf('TURN_TIMEOUT')).toEqual([expect.objectContaining({ playerId: first.activePlayerId })]);
    expect(next.teams.A.score + next.teams.B.score).toBe(0);
  });

  it('first team to the target wins; winners get the bonus', () => {
    const h = new EngineHarness(['A', 'B']).startGame(setup({ targetScore: 2 }));
    const firstTeam = h.state('teamRelay').activeTeam;
    const used: string[] = [];
    answer(h, used); // first team 1
    h.advance(5000); // second team times out
    const winning = answer(h, used); // first team 2 → win
    expect(winning.team).toBe(firstTeam);
    expect(h.eventsOf('TEAM_WIN')).toEqual([expect.objectContaining({ team: firstTeam })]);
    h.advance(100);
    const r = h.engine.lastRound!;
    expect(r.winningTeam).toBe(firstTeam);
    expect(r.scores[0]).toMatchObject({ playerId: winning.player, points: 5 + 5 + 20, words: 2 });
    expect(r.scores[1].points).toBe(0);
  });

  it('time running out decides by score (draw possible)', () => {
    const h = new EngineHarness(['A', 'B']).startGame(setup({ roundMs: 3000 }));
    h.advance(3000);
    expect(h.engine.lastRound!.winningTeam).toBe('DRAW');
  });

  it('a shield gives the active player one extra turn length', () => {
    const h = new EngineHarness(['A', 'B']).startGame({ ...setup(), modifiers: { itemsEnabled: true } });
    const p = h.state('teamRelay').activePlayerId!;
    h.engine.useItem(p, { item: 'shield' }, h.now);
    h.advance(5000);
    expect(h.state('teamRelay').activePlayerId).toBe(p);
    h.advance(5000);
    expect(h.state('teamRelay').activePlayerId).not.toBe(p);
  });
});
