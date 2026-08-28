import { beforeEach, describe, expect, it } from 'vitest';
import { gameSnapshot } from '../test/fixtures';
import { useGameStore } from './gameStore';

describe('game store', () => {
  beforeEach(() => {
    localStorage.clear();
    useGameStore.setState({
      session: null,
      snapshot: null,
      connectionStatus: 'idle',
      pendingCommandId: null,
      pendingCommandType: null,
      error: null,
      notice: null,
    });
  });

  it('does not roll state back when an older snapshot arrives', () => {
    useGameStore.getState().setSnapshot(gameSnapshot);
    useGameStore.getState().setSnapshot({ ...gameSnapshot, version: gameSnapshot.version - 1, currentBet: 999 });
    expect(useGameStore.getState().snapshot?.version).toBe(gameSnapshot.version);
    expect(useGameStore.getState().snapshot?.currentBet).toBe(100);
  });

  it('tracks a command until its acknowledgement', () => {
    useGameStore.getState().beginCommand('command-1', 'player_action');
    expect(useGameStore.getState().pendingCommandId).toBe('command-1');
    useGameStore.getState().completeCommand({
      status: 'accepted',
      commandId: 'command-1',
      appliedVersion: 13,
    });
    expect(useGameStore.getState().pendingCommandId).toBeNull();
  });
});
