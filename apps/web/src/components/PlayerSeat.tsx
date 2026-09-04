import { CircleDot, Coins, Crown, Wifi, WifiOff } from 'lucide-react';
import type { PlayerState } from '../lib/protocol';
import type { TablePosition } from '../lib/tableLayout';
import { betActionLabel } from '../lib/playerAction';
import { PlayingCard } from './PlayingCard';

interface PlayerSeatProps {
  player: PlayerState;
  position: TablePosition;
  playerCount: number;
  isHero: boolean;
  isActing: boolean;
  isButton: boolean;
  showCards: boolean;
  expanded: boolean;
  showDetails: boolean;
  onToggleDetails: () => void;
}

const STATUS_LABELS: Record<PlayerState['status'], string> = {
  waiting: '等待中',
  active: '游戏中',
  folded: '已弃牌',
  all_in: '全下',
  sitting_out: '暂不参与',
  managed: '托管中',
  leaving: '离房待结算',
  eliminated: '等待补筹码',
};

interface SeatDetailsProps {
  player: PlayerState;
  isButton: boolean;
  className?: string;
}

export const SeatDetails = ({ player, isButton, className = 'seat-details' }: SeatDetailsProps) => {
  const statusLabel = player.lastAction || STATUS_LABELS[player.status];
  const connectionLabel = isButton ? '庄家' : player.online ? '在线' : '离线';

  return (
    <section className={className} id={`seat-details-${player.seat}`} aria-label={`${player.nickname}的座位详情`}>
      <div className="seat-detail-heading">
        <span>#{player.seat + 1}</span>
        <strong>{player.nickname}</strong>
      </div>
      <span className="seat-detail-value" aria-label={`本街下注 ${player.streetBet.toLocaleString('zh-CN')}`}>
        <Coins size={14} aria-hidden="true" />
        <span className="seat-detail-label">本街</span>
        <strong>{player.streetBet.toLocaleString('zh-CN')}</strong>
      </span>
      <span className="seat-detail-value" aria-label={`累计投入 ${player.committed.toLocaleString('zh-CN')}`}>
        <CircleDot size={14} aria-hidden="true" />
        <span className="seat-detail-label">累计</span>
        <strong>{player.committed.toLocaleString('zh-CN')}</strong>
      </span>
      <span className="seat-detail-state" aria-label={`当前状态 ${statusLabel}`}>
        <CircleDot size={14} aria-hidden="true" />
        <span>{statusLabel}</span>
      </span>
      <span className="seat-detail-state" aria-label={connectionLabel}>
        {isButton ? <Crown size={14} aria-hidden="true" /> : player.online ? <Wifi size={14} aria-hidden="true" /> : <WifiOff size={14} aria-hidden="true" />}
        <span>{connectionLabel}</span>
      </span>
    </section>
  );
};

export const PlayerSeat = ({
  player,
  position,
  playerCount,
  isHero,
  isActing,
  isButton,
  showCards,
  expanded,
  showDetails,
  onToggleDetails,
}: PlayerSeatProps) => {
  if (isHero) return null;

  const actionLabel = player.status === 'folded' ? null : betActionLabel(player.lastAction);
  const horizontalEdge = position.x <= 12 ? 'start' : position.x >= 88 ? 'end' : 'center';
  const statusLabel = STATUS_LABELS[player.status];

  return (
  <div
    className={`player-seat occupied relative-seat-${position.relativeSeat} ${isActing ? 'acting' : ''}`}
    data-seat={player.seat}
    data-player-count={playerCount}
    data-horizontal-edge={horizontalEdge}
    data-detail-placement={position.detailPlacement}
    style={{ left: `${position.x}%`, top: `${position.y}%` }}
  >
    {showCards && (
      <button
        className="seat-cards seat-detail-trigger"
        type="button"
        aria-label={`${player.nickname}的底牌`}
        aria-expanded={expanded}
        aria-controls={`seat-details-${player.seat}`}
        title="查看座位详情"
        onClick={onToggleDetails}
      >
        <PlayingCard card={player.holeCards?.[0]} hidden={!player.holeCards?.[0]} compact />
        <PlayingCard card={player.holeCards?.[1]} hidden={!player.holeCards?.[1]} compact />
      </button>
    )}
    <button
      className="seat-shell seat-detail-trigger"
      type="button"
      aria-expanded={expanded}
      aria-controls={`seat-details-${player.seat}`}
      onClick={onToggleDetails}
    >
      {isActing && <span className="turn-ring" aria-hidden="true" />}
      <div className="seat-name-row">
        <span className="seat-index-badge">#{player.seat + 1}</span>
        <strong data-testid="player-name">{player.nickname}</strong>
        {player.isHost && <Crown size={13} aria-label="房主" />}
        {!player.online && <WifiOff size={13} aria-label="离线" />}
        {player.status !== 'active' && (
          <CircleDot className={`seat-state-icon status-${player.status}`} size={13} aria-label={statusLabel} />
        )}
      </div>
      <span className="seat-stack"><Coins size={13} aria-hidden="true" /> {player.stack.toLocaleString('zh-CN')}</span>
      {isButton && <span className="dealer-button" title="庄家按钮">D</span>}
    </button>
    {actionLabel && player.streetBet > 0 && (
      <span className={`seat-bet seat-bet--${actionLabel.toLowerCase()}`}>
        <small>{actionLabel}</small>
        <strong>{player.streetBet.toLocaleString('zh-CN')}</strong>
      </span>
    )}
    {expanded && showDetails && <SeatDetails player={player} isButton={isButton} />}
  </div>
  );
};
