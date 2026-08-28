import { Crown, WifiOff } from 'lucide-react';
import type { PlayerState } from '../lib/protocol';
import type { TablePosition } from '../lib/tableLayout';
import { PlayingCard } from './PlayingCard';

interface PlayerSeatProps {
  player: PlayerState;
  position: TablePosition;
  isHero: boolean;
  isActing: boolean;
  isButton: boolean;
  showCards: boolean;
}

const STATUS_LABELS: Record<PlayerState['status'], string> = {
  waiting: '等待中',
  active: '游戏中',
  folded: '已弃牌',
  all_in: '全下',
  sitting_out: '暂不参与',
  eliminated: '等待补筹码',
};

export const PlayerSeat = ({ player, position, isHero, isActing, isButton, showCards }: PlayerSeatProps) => {
  if (isHero) return null;

  return (
  <div
    className={`player-seat occupied relative-seat-${position.relativeSeat} ${isActing ? 'acting' : ''}`}
    data-seat={player.seat}
    style={{ left: `${position.x}%`, top: `${position.y}%` }}
  >
    {showCards && (
      <div className="seat-cards" aria-label={`${player.nickname}的底牌`}>
        <PlayingCard card={player.holeCards?.[0]} hidden={!player.holeCards?.[0]} compact />
        <PlayingCard card={player.holeCards?.[1]} hidden={!player.holeCards?.[1]} compact />
      </div>
    )}
    <div className="seat-shell">
      {isActing && <span className="turn-ring" aria-hidden="true" />}
      <div className="seat-name-row">
        <span className="seat-index-badge">#{player.seat + 1}</span>
        <strong data-testid="player-name">{player.nickname}</strong>
        {player.isHost && <Crown size={13} aria-label="房主" />}
        {!player.online && <WifiOff size={13} aria-label="离线" />}
      </div>
      <span className="seat-stack">{player.stack.toLocaleString('zh-CN')}</span>
      <span className={`seat-status status-${player.status}`}>{player.lastAction || STATUS_LABELS[player.status]}</span>
      {isButton && <span className="dealer-button" title="庄家按钮">D</span>}
    </div>
    {player.streetBet > 0 && <span className="seat-bet">{player.streetBet.toLocaleString('zh-CN')}</span>}
  </div>
  );
};
