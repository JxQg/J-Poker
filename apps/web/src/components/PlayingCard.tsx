import cardBack from '../assets/card-back.svg';
import type { CardCode } from '../lib/protocol';

const SUITS = {
  c: { symbol: '♣', label: '梅花', className: 'suit-club' },
  d: { symbol: '♦', label: '方块', className: 'suit-diamond' },
  h: { symbol: '♥', label: '红桃', className: 'suit-heart' },
  s: { symbol: '♠', label: '黑桃', className: 'suit-spade' },
} as const;

const RANKS: Record<string, string> = {
  T: '10',
  J: 'J',
  Q: 'Q',
  K: 'K',
  A: 'A',
};

interface PlayingCardProps {
  card?: CardCode;
  hidden?: boolean;
  compact?: boolean;
}

export const PlayingCard = ({ card, hidden = false, compact = false }: PlayingCardProps) => {
  if (hidden || !card) {
    return (
      <div className={`playing-card card-back ${compact ? 'compact' : ''}`} aria-label="暗牌">
        <img src={cardBack} alt="" />
      </div>
    );
  }

  const rank = card.slice(0, -1);
  const suit = SUITS[card.at(-1) as keyof typeof SUITS];
  return (
    <div
      className={`playing-card ${suit.className} ${compact ? 'compact' : ''}`}
      aria-label={`${suit.label}${RANKS[rank] ?? rank}`}
    >
      <span className="card-rank">{RANKS[rank] ?? rank}</span>
      <span className="card-suit">{suit.symbol}</span>
      <span className="card-corner" aria-hidden="true">{suit.symbol}</span>
    </div>
  );
};
