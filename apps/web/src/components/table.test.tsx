import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { tableDensityForPlayerCount, tablePositionForSeat } from '../lib/tableLayout';
import type { GameSnapshot, PlayerState } from '../lib/protocol';
import { gameSnapshot } from '../test/fixtures';
import { ActionBar } from './ActionBar';
import { Lobby } from './Lobby';
import { PokerTable } from './PokerTable';
import { RoomLogPanel } from './RoomLogPanel';

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
    expect(screen.getByLabelText('按钮位的座位详情')).toHaveTextContent('本街100');
    expect(screen.getByLabelText('按钮位的座位详情')).toHaveTextContent('累计100');

    const secondSeat = screen.getByRole('button', { name: '转牌手的底牌' });
    fireEvent.click(secondSeat);
    expect(firstSeat).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('按钮位的座位详情')).not.toBeInTheDocument();
    expect(screen.getByLabelText('转牌手的座位详情')).toHaveTextContent('离线');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByLabelText('转牌手的座位详情')).not.toBeInTheDocument();
  });

  it('keeps the hero at the bottom while rotating every seat around the table', () => {
    const tenSeats = Array.from({ length: 10 }, (_, seat) => seat);
    expect(tablePositionForSeat(4, tenSeats, 4)).toMatchObject({ x: 50, y: 84, relativeSeat: 0 });
    expect(tablePositionForSeat(1, [0, 1], 0)).toMatchObject({ x: 50, y: 16, relativeSeat: 1 });
    const tenSeatCoordinates = tenSeats.map((seat) => {
      const position = tablePositionForSeat(seat, tenSeats, 4);
      return `${position.x}:${position.y}`;
    });
    expect(new Set(tenSeatCoordinates).size).toBe(10);
  });

  it.each([
    [2, 'roomy'],
    [4, 'roomy'],
    [6, 'standard'],
    [8, 'compact'],
    [10, 'dense'],
  ] as const)('uses a stable %s-player %s layout with no duplicate seats', (playerCount, density) => {
    const seats = Array.from({ length: playerCount }, (_, seat) => seat);
    const positions = seats.map((seat) => tablePositionForSeat(seat, seats, 0));

    expect(tableDensityForPlayerCount(playerCount)).toBe(density);
    expect(positions[0]).toMatchObject({ x: 50, y: 84, relativeSeat: 0 });
    expect(new Set(positions.map(({ x, y }) => `${x}:${y}`)).size).toBe(playerCount);
    expect(positions.every(({ detailPlacement }) => ['top', 'bottom', 'left', 'right'].includes(detailPlacement))).toBe(true);
  });

  it('opens the poker terms drawer from the action dock', () => {
    const onCommand = vi.fn().mockResolvedValue(undefined);
    render(<ActionBar snapshot={gameSnapshot} pending={false} onCommand={onCommand} />);

    fireEvent.click(screen.getAllByTitle('牌桌术语').at(-1)!);
    expect(screen.getByRole('dialog', { name: '德州扑克术语' })).toHaveTextContent('RFI / Open Raise');
  });

  it('centers the settlement toast and keeps final hands with the next-hand action', () => {
    const settlementSnapshot: GameSnapshot = {
      ...gameSnapshot,
      phase: 'settlement' as const,
      settlement: {
        winners: [{ memberId: 'member-1', nickname: '河牌手', amount: 220, handName: '一对' }],
      },
      completedHands: [{
        handId: 'hand-1',
        handNumber: 1,
        completedAt: '2030-01-01T00:00:30.000Z',
        board: ['Ah', '7d', '2c', 'Ts', '9h'],
        pot: 220,
        players: [
          {
            memberId: 'member-1',
            nickname: '河牌手',
            seat: 0,
            holeCards: ['As', 'Kh'],
            handName: '一对',
            delta: 120,
            folded: false,
          },
          {
            memberId: 'member-2',
            nickname: '按钮位',
            seat: 2,
            holeCards: ['Qd', 'Jd'],
            handName: '高牌',
            delta: -120,
            folded: false,
          },
        ],
      }],
    };
    render(
      <>
        <PokerTable snapshot={settlementSnapshot} pending={false} onCommand={vi.fn()} />
        <ActionBar snapshot={settlementSnapshot} pending={false} onCommand={vi.fn()} />
      </>,
    );
    expect(screen.getByTestId('settlement-ready')).toHaveTextContent('准备下一手');
    expect(screen.getByTestId('settlement-player-member-1')).toHaveTextContent('一对');
    expect(screen.getByTestId('settlement-player-member-2')).toHaveTextContent('高牌');
    expect(document.querySelector('.settlement-positioner')).toBeInTheDocument();
    expect(document.querySelector('.settlement-strip')).toBeInTheDocument();
  });

  it('shows every showdown player while keeping folded cards and hand names private', () => {
    const resultSnapshot: GameSnapshot = {
      ...gameSnapshot,
      roomLogs: [{
        id: 'settled-log',
        type: 'HandSettled',
        message: '第 1 手结算完成',
        createdAt: '2030-01-01T00:01:00.000Z',
        handId: 'completed-hand-1',
      }],
      completedHands: [{
        handId: 'completed-hand-1',
        handNumber: 1,
        completedAt: '2030-01-01T00:01:00.000Z',
        board: ['Ah', '7d', '2c', 'Ts', '9h'],
        pot: 600,
        players: [
          {
            memberId: 'winner',
            nickname: '赢家',
            seat: 0,
            holeCards: ['As', 'Kh'],
            handName: '一对',
            delta: 320,
            folded: false,
          },
          {
            memberId: 'showdown-loser',
            nickname: '摊牌玩家',
            seat: 1,
            holeCards: ['Qd', 'Jd'],
            handName: '高牌',
            delta: -180,
            folded: false,
          },
          {
            memberId: 'folded-player',
            nickname: '弃牌玩家',
            seat: 2,
            holeCards: [],
            handName: '未摊牌',
            delta: -140,
            folded: true,
          },
        ],
      }],
    };
    render(<RoomLogPanel snapshot={resultSnapshot} />);

    fireEvent.click(screen.getByRole('button', { name: /房间日志/ }));

    expect(screen.getByTestId('completed-hand-player-winner')).toHaveTextContent('一对');
    expect(screen.getByTestId('completed-hand-player-showdown-loser')).toHaveTextContent('高牌');
    expect(screen.getByTestId('completed-hand-player-winner').querySelectorAll('.playing-card')).toHaveLength(2);
    expect(screen.getByTestId('completed-hand-player-showdown-loser').querySelectorAll('.playing-card')).toHaveLength(2);
    expect(screen.getByTestId('completed-hand-player-folded-player')).toHaveTextContent('已弃牌');
    expect(screen.getByTestId('completed-hand-player-folded-player').querySelectorAll('.playing-card')).toHaveLength(0);
    expect(screen.getByTestId('completed-hand-player-folded-player')).not.toHaveTextContent('未摊牌');
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
