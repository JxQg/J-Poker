import { describe, expect, it } from 'vitest';
import { normalizeSnapshot } from './protocol';

describe('normalizeSnapshot', () => {
  it('maps the canonical nested server snapshot to the UI model', () => {
    const snapshot = normalizeSnapshot({
      protocolVersion: '1.0',
      rulesVersion: 'pokerkit-0.7.5/nlhe-v1',
      roomId: 'room-1',
      roomCode: 'abcd2345',
      version: 9,
      phase: 'playing',
      config: { maxPlayers: 2, smallBlind: 10, bigBlind: 20, initialStack: 2000, actionTimeoutSeconds: 30 },
      you: { memberId: 'member-1', seat: 0, isHost: true },
      players: [
        {
          memberId: 'member-1', nickname: 'Hero', seat: 0, stack: 1900, streetBet: 100,
          committed: 100, status: 'active', ready: true, online: true, isHost: true,
          holeCards: [
            { code: 'As', deckIndex: 0, salt: 'salt', proof: [] },
            { code: 'Kh', deckIndex: 1, salt: 'salt', proof: [] },
          ],
        },
        {
          memberId: 'member-2', nickname: 'Villain', seat: 1, stack: 1900, streetBet: 100,
          committed: 100, status: 'active', ready: true, online: true, isHost: false, holeCards: null,
        },
      ],
      hand: {
        handId: 'hand-1', handNumber: 1, buttonSeat: 0, street: 'flop',
        board: [{ code: '2c', deckIndex: 4, salt: 'salt', proof: [] }],
        pot: 200, pots: [{ amount: 200, eligibleMemberIds: ['member-1', 'member-2'] }],
        currentBet: 100, actorMemberId: 'member-2', actorSeat: 1, turnId: 'turn-2',
        deadlineAt: '2030-01-01T00:00:30Z',
        legalActions: { canFold: true, canCall: true, callAmount: 20, minRaiseTo: 200, maxRaiseTo: 1900 },
      },
      fairness: {
        serverCommitment: 'commit', merkleRoot: 'root', contributionsReceived: 2,
        contributionsRequired: 2, contributionRequired: false,
      },
      serverNow: '2030-01-01T00:00:00Z',
      closePending: true,
    });

    expect(snapshot.roomCode).toBe('ABCD2345');
    expect(snapshot.heroMemberId).toBe('member-1');
    expect(snapshot.actingSeat).toBe(1);
    expect(snapshot.holeCards).toEqual(['As', 'Kh']);
    expect(snapshot.communityCards).toEqual(['2c']);
    expect(snapshot.legalActions.minRaiseTo).toBe(200);
    expect(snapshot.pots[0]?.amount).toBe(200);
    expect(snapshot.closePending).toBe(true);
    expect(snapshot.fairness.contributionRequired).toBe(false);
    expect(snapshot.players[0]?.rankingScore).toBe(1900);
  });

  it('rejects a snapshot without room identity', () => {
    expect(() => normalizeSnapshot({ phase: 'lobby', players: [], version: 0 })).toThrow('无效的房间快照');
  });
});
