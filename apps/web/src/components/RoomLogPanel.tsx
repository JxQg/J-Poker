import { ChevronDown, ClipboardList, Trophy } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { CompletedHand, GameSnapshot } from '../lib/protocol';
import { PlayingCard } from './PlayingCard';

interface RoomLogPanelProps {
  snapshot: GameSnapshot;
}

const deltaLabel = (delta: number): string => `${delta > 0 ? '+' : ''}${delta.toLocaleString('zh-CN')}`;

const HandResult = ({ hand }: { hand: CompletedHand }) => (
  <section className="log-hand-result" aria-label={`第 ${hand.handNumber} 手结算`}>
    <div className="log-hand-heading">
      <strong><Trophy size={13} /> 第 {hand.handNumber} 手</strong>
      <span>底池 {hand.pot.toLocaleString('zh-CN')}</span>
    </div>
    <div className="log-board" aria-label="本手公共牌">
      {hand.board.map((card, index) => <PlayingCard card={card} compact key={`${card}-${index}`} />)}
    </div>
    <div className="log-hand-players">
      {hand.players.map((player) => (
        <div className={`log-hand-player ${player.folded ? 'folded' : ''}`} key={player.memberId}>
          <div className="log-player-line">
            <strong>{player.nickname}</strong>
            <span className={player.delta > 0 ? 'positive' : player.delta < 0 ? 'negative' : ''}>
              {deltaLabel(player.delta)}
            </span>
          </div>
          <div className="log-player-cards">
            {player.holeCards.map((card, index) => <PlayingCard card={card} compact key={`${card}-${index}`} />)}
            {!player.folded && <small>{player.handName || 'Uncontested'}</small>}
          </div>
        </div>
      ))}
    </div>
  </section>
);

export const RoomLogPanel = ({ snapshot }: RoomLogPanelProps) => {
  const [open, setOpen] = useState(
    () => typeof window !== 'undefined' && window.matchMedia?.('(min-width: 1080px)').matches,
  );
  const handsById = useMemo(
    () => new Map(snapshot.completedHands.map((hand) => [hand.handId, hand])),
    [snapshot.completedHands],
  );
  const entries = useMemo(() => [...snapshot.roomLogs].reverse(), [snapshot.roomLogs]);

  return (
    <aside className={`room-log-panel ${open ? 'open' : ''}`} aria-label="房间日志">
      <button
        className="room-log-toggle"
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span><ClipboardList size={20} /><span className="panel-heading-label">房间日志</span></span>
        <small>{snapshot.roomLogs.length}</small>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {open && (
        <div className="room-log-stream" role="log" aria-live="polite">
          {entries.length === 0 ? (
            <p className="room-log-empty">本局动态会显示在这里</p>
          ) : entries.map((entry) => (
            <article className="room-log-entry" key={entry.id}>
              <p>{entry.message}</p>
              {entry.type === 'HandSettled' && entry.handId && handsById.get(entry.handId) && (
                <HandResult hand={handsById.get(entry.handId)!} />
              )}
            </article>
          ))}
        </div>
      )}
    </aside>
  );
};
