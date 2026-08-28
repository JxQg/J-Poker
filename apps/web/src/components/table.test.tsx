import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { tablePositionForSeat } from '../lib/tableLayout';
import { gameSnapshot } from '../test/fixtures';
import { ActionBar } from './ActionBar';
import { Lobby } from './Lobby';
import { PokerTable } from './PokerTable';

describe('poker table', () => {
  it('renders the player layout, leaderboard, and legal actions', () => {
    const onCommand = vi.fn().mockResolvedValue(undefined);
    render(
      <>
        <PokerTable snapshot={gameSnapshot} pending={false} onCommand={onCommand} />
        <ActionBar snapshot={gameSnapshot} pending={false} onCommand={onCommand} />
      </>,
    );
    expect(screen.getByTestId('poker-table')).toBeInTheDocument();
    expect(screen.getAllByTestId('player-name')).toHaveLength(1);
    expect(screen.getByText('河牌手')).toBeInTheDocument();
    expect(screen.getByLabelText('黑桃A')).toBeInTheDocument();
    expect(screen.getByTestId('action-fold')).toBeEnabled();
    expect(screen.getByTestId('action-check')).toBeDisabled();
    expect(screen.getByTestId('action-call')).toHaveTextContent('20');
    expect(screen.getByRole('button', { name: '2X' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '3X' })).toBeEnabled();
    expect(screen.queryByText('1x 跟注')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '2X' }));
    expect(screen.getByRole('button', { name: '加注 2X' })).toBeInTheDocument();
    expect(onCommand).not.toHaveBeenCalledWith('player_action', { action: 'raise_to', amount: 200 });
    fireEvent.click(screen.getByRole('button', { name: '加注 2X' }));
    expect(onCommand).toHaveBeenCalledWith('player_action', { action: 'raise_to', amount: 200 });
    expect(screen.getByRole('button', { name: /SHOWHAND/ })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: /积分榜/ }));
    expect(screen.getByLabelText('积分榜')).toHaveTextContent('按钮位');
  });

  it('keeps the hero at the bottom while rotating every seat around the table', () => {
    expect(tablePositionForSeat(4, 10, 4)).toMatchObject({ x: 50, y: 92, relativeSeat: 0 });
    expect(tablePositionForSeat(1, 2, 0)).toMatchObject({ x: 50, y: 8, relativeSeat: 1 });
    const tenSeatCoordinates = Array.from({ length: 10 }, (_, seat) => {
      const position = tablePositionForSeat(seat, 10, 4);
      return `${position.x}:${position.y}`;
    });
    expect(new Set(tenSeatCoordinates).size).toBe(10);
  });

  it('opens the poker terms drawer from the action dock', () => {
    const onCommand = vi.fn().mockResolvedValue(undefined);
    render(<ActionBar snapshot={gameSnapshot} pending={false} onCommand={onCommand} />);

    fireEvent.click(screen.getAllByTitle('牌桌术语').at(-1)!);
    expect(screen.getByRole('dialog', { name: '德州扑克术语' })).toHaveTextContent('RFI / Open Raise');
  });

  it('shows the rebuy action in the waiting lobby at or below the big blind', () => {
    const onCommand = vi.fn().mockResolvedValue(undefined);
    const waitingSnapshot = {
      ...gameSnapshot,
      phase: 'lobby' as const,
      handId: null,
      players: gameSnapshot.players.map((player, index) => (
        index === 0 ? { ...player, stack: 20 } : player
      )),
    };
    render(<Lobby snapshot={waitingSnapshot} pending={false} onCommand={onCommand} />);
    expect(screen.getByRole('button', { name: '申请借款积分' })).toBeEnabled();
  });

  it('keeps the rebuy action under the hero seat while waiting outside a hand', () => {
    const onCommand = vi.fn().mockResolvedValue(undefined);
    const waitingSnapshot = {
      ...gameSnapshot,
      phase: 'playing' as const,
      handId: 'hand-2',
      players: gameSnapshot.players.map((player, index) => (
        index === 0 ? { ...player, stack: 20, status: 'waiting' as const } : player
      )),
    };
    render(<PokerTable snapshot={waitingSnapshot} pending={false} onCommand={onCommand} />);
    expect(screen.getByRole('button', { name: '申请借款积分' })).toBeEnabled();
  });
});
