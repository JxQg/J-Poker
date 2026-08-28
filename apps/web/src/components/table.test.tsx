import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { tablePositionForSeat } from '../lib/tableLayout';
import type { PlayerState } from '../lib/protocol';
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
    expect(screen.getByLabelText('减少加注')).toBeDisabled();
    expect(screen.getByLabelText('增加加注')).toBeEnabled();
    expect(screen.getByLabelText('加注总额')).toHaveValue(200);
    expect(screen.queryByText('1x 跟注')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '2X' }));
    expect(screen.getByRole('button', { name: '加注 2X' })).toBeInTheDocument();
    expect(onCommand).not.toHaveBeenCalledWith('player_action', { action: 'raise_to', amount: 200 });
    fireEvent.click(screen.getByRole('button', { name: '加注 2X' }));
    expect(onCommand).toHaveBeenCalledWith('player_action', { action: 'raise_to', amount: 200 });
    expect(screen.getByRole('button', { name: /SHOWHAND/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /SHOWHAND/ }).closest('.action-modules')).not.toBeNull();
    const raiseControls = document.querySelector('.raise-controls-row');
    expect(raiseControls?.querySelector('.raise-presets')).toBeInTheDocument();
    expect(raiseControls?.querySelector('.raise-amount-control')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /积分榜/ }));
    expect(screen.getByLabelText('积分榜')).toHaveTextContent('按钮位');
  });

  it('shows CALL and RAISE markers above each player hand using each street bet', () => {
    const markerSnapshot = {
      ...gameSnapshot,
      players: gameSnapshot.players.map((player, index) => ({
        ...player,
        lastAction: index === 0 ? 'call' : 'raise_to:100',
      })),
    };
    render(<PokerTable snapshot={markerSnapshot} pending={false} onCommand={vi.fn()} />);
    expect(screen.getByText('CALL')).toBeInTheDocument();
    expect(screen.getByText('120', { selector: '.hero-bet-action strong' })).toBeInTheDocument();
    expect(screen.getByText('RAISE')).toBeInTheDocument();
    expect(screen.getByText('100', { selector: '.seat-bet--raise strong' })).toBeInTheDocument();
    expect(document.querySelector('.player-seat')?.getAttribute('data-detail-placement')).toBeTruthy();
    expect(document.querySelector('.seat-bet')).toBeInTheDocument();
  });

  it('expands one opponent detail card at a time and closes it with Escape', () => {
    const secondOpponent: PlayerState = {
      ...gameSnapshot.players[1]!,
      memberId: 'member-3',
      nickname: '转牌手',
      seat: 3,
      online: false,
      status: 'managed' as const,
    };
    const snapshot = { ...gameSnapshot, players: [...gameSnapshot.players, secondOpponent] };
    render(<PokerTable snapshot={snapshot} pending={false} onCommand={vi.fn()} />);

    const firstSeat = screen.getByRole('button', { name: '按钮位的底牌' });
    fireEvent.click(firstSeat);
    expect(firstSeat).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('按钮位的座位详情')).toHaveTextContent('本街 100');
    expect(screen.getByLabelText('按钮位的座位详情')).toHaveTextContent('累计 100');

    const secondSeat = screen.getByRole('button', { name: '转牌手的底牌' });
    fireEvent.click(secondSeat);
    expect(firstSeat).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('按钮位的座位详情')).not.toBeInTheDocument();
    expect(screen.getByLabelText('转牌手的座位详情')).toHaveTextContent('离线');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByLabelText('转牌手的座位详情')).not.toBeInTheDocument();
  });

  it('keeps the hero at the bottom while rotating every seat around the table', () => {
    expect(tablePositionForSeat(4, 10, 4)).toMatchObject({ x: 50, y: 92, relativeSeat: 0 });
    expect(tablePositionForSeat(1, 2, 0)).toMatchObject({ x: 50, y: 16, relativeSeat: 1 });
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

  it('centers the settlement toast and exposes the next-hand ready action', () => {
    const settlementSnapshot = {
      ...gameSnapshot,
      phase: 'settlement' as const,
      settlement: {
        winners: [{ memberId: 'member-1', nickname: '河牌手', amount: 220, handName: '一对' }],
      },
    };
    render(<PokerTable snapshot={settlementSnapshot} pending={false} onCommand={vi.fn()} />);
    expect(screen.getByText('准备下一手')).toBeInTheDocument();
    expect(document.querySelector('.settlement-positioner')).toBeInTheDocument();
    expect(document.querySelector('.settlement-strip')).toBeInTheDocument();
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

  it('does not expose an empty hero card region while waiting for the next hand', () => {
    const waitingSnapshot = {
      ...gameSnapshot,
      phase: 'playing' as const,
      handId: 'hand-2',
      holeCards: [],
      players: gameSnapshot.players.map((player, index) => (
        index === 0 ? { ...player, status: 'waiting' as const } : player
      )),
    };
    render(<PokerTable snapshot={waitingSnapshot} pending={false} onCommand={vi.fn()} />);
    expect(screen.queryByLabelText('你的底牌')).not.toBeInTheDocument();
  });
});
