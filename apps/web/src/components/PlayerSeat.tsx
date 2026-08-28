import { CircleDot, Coins, Crown, Wifi, WifiOff } from 'lucide-react';
import type { PlayerState } from '../lib/protocol';
import type { TablePosition } from '../lib/tableLayout';
import { betActionLabel } from '../lib/playerAction';
import { PlayingCard } from './PlayingCard';

interface PlayerSeatProps {
  player: PlayerState;
  position: TablePosition;
  isHero: boolean;
  isActing: boolean;
  isButton: boolean;
  showCards: boolean;
  expanded: boolean;
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

const detailPlacement = ({ x, y }: TablePosition): 'bottom' | 'left' | 'right' => {
  if (y <= 22) return 'bottom';
  return x < 50 ? 'right' : 'left';
};

export const PlayerSeat = ({
  player,
  position,
  isHero,
  isActing,
  isButton,
  showCards,
  expanded,
  onToggleDetails,
}: PlayerSeatProps) => {
  if (isHero) return null;

  const actionLabel = player.status === 'folded' ? null : betActionLabel(player.lastAction);
  const horizontalEdge = position.x <= 12 ? 'start' : position.x >= 88 ? 'end' : 'center';

  return (
  <div
    className={`player-seat occupied relative-seat-${position.relativeSeat} ${isActing ? 'acting' : ''}`}
    data-seat={player.seat}
    data-horizontal-edge={horizontalEdge}
    data-detail-placement={detailPlacement(position)}
    style={{ left: `${position.x}%`, top: `${position.y}%` }}
  >
    {showCards && (
      <button
        className="seat-cards seat-detail-trigger"
        type="button"
        aria-label={`${player.nickname}的底牌`}
        aria-expanded={expanded}
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
    {expanded && (
      <section className="seat-details" id={`seat-details-${player.seat}`} aria-label={`${player.nickname}的座位详情`}>
        <span><Coins size={14} aria-hidden="true" /> 本街 <strong>{player.streetBet.toLocaleString('zh-CN')}</strong></span>
        <span><CircleDot size={14} aria-hidden="true" /> 累计 <strong>{player.committed.toLocaleString('zh-CN')}</strong></span>
        <span><CircleDot size={14} aria-hidden="true" /> {player.lastAction || STATUS_LABELS[player.status]}</span>
        <span>{isButton ? <Crown size={14} aria-hidden="true" /> : player.online ? <Wifi size={14} aria-hidden="true" /> : <WifiOff size={14} aria-hidden="true" />}{isButton ? '庄家' : player.online ? '在线' : '离线'}</span>
      </section>
    )}
  </div>
  );
};
