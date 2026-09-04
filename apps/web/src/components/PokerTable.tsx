import { CircleDollarSign, LockKeyhole, Pause, Play, ShieldCheck, UserRound, WalletCards, XCircle } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useMediaQuery } from '../hooks/useMediaQuery';
import type { GameSnapshot, RoomCommandType } from '../lib/protocol';
import { betActionLabel } from '../lib/playerAction';
import { tableDensityForPlayerCount, tablePositionForSeat } from '../lib/tableLayout';
import { PlayerSeat, SeatDetails } from './PlayerSeat';
import { PlayingCard } from './PlayingCard';
import { LeaderboardPanel } from './LeaderboardPanel';
import { RoomLogPanel } from './RoomLogPanel';

interface PokerTableProps {
  snapshot: GameSnapshot;
  pending: boolean;
  onCommand: (type: RoomCommandType, payload?: Record<string, unknown>) => Promise<unknown>;
}

interface Rectangle {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

interface SettlementRail {
  top: number;
  width: number;
}

interface VerticalInterval {
  start: number;
  end: number;
}

const intersects = (first: Rectangle, second: Rectangle): boolean => (
  first.left < second.right
  && first.right > second.left
  && first.top < second.bottom
  && first.bottom > second.top
);

const visibleRectangle = (element: HTMLElement): Rectangle | null => {
  const style = window.getComputedStyle(element);
  const bounds = element.getBoundingClientRect();
  if (style.display === 'none' || style.visibility === 'hidden' || bounds.width === 0 || bounds.height === 0) return null;
  return bounds;
};

const useSettlementSafeRail = (active: boolean) => {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const [rail, setRail] = useState<SettlementRail | null>(null);

  useLayoutEffect(() => {
    if (!active) {
      setRail(null);
      return undefined;
    }

    const update = () => {
      const surface = surfaceRef.current;
      const rail = railRef.current;
      if (!surface || !rail) return;

      const surfaceBounds = surface.getBoundingClientRect();
      const railBounds = rail.getBoundingClientRect();
      if (railBounds.width === 0 || railBounds.height === 0) return;
      const protectedBounds = [...surface.querySelectorAll<HTMLElement>(
        '.board-zone, .hero-hand-zone, .seat-shell, .seat-cards, .seat-bet',
      )].flatMap((element) => {
        const bounds = visibleRectangle(element);
        return bounds ? [bounds] : [];
      });
      const board = surface.querySelector<HTMLElement>('.board-zone');
      const boardBounds = board ? visibleRectangle(board) : null;
      const compactViewport = window.matchMedia('(max-width: 740px)').matches;
      const widestRail = Math.min(railBounds.width, surfaceBounds.width - 24);
      const narrowestRail = Math.min(widestRail, compactViewport ? 164 : 260);
      const railWidths: number[] = [];
      for (let width = widestRail; width >= narrowestRail; width -= 12) {
        railWidths.push(Math.round(width));
      }
      if (!railWidths.includes(Math.round(narrowestRail))) railWidths.push(Math.round(narrowestRail));

      const centerForWidth = (width: number): number | null => {
        const halfHeight = railBounds.height / 2;
        const edgeInset = 6;
        const minimum = surfaceBounds.top + halfHeight + edgeInset;
        const maximum = surfaceBounds.bottom - halfHeight - edgeInset;
        if (minimum > maximum) return null;

        const candidateLeft = surfaceBounds.left + (surfaceBounds.width - width) / 2;
        const candidateRight = candidateLeft + width;
        const blocked = protectedBounds
          .filter((bounds) => candidateLeft < bounds.right && candidateRight > bounds.left)
          .map((bounds): VerticalInterval => ({
            start: Math.max(minimum, bounds.top - halfHeight - edgeInset),
            end: Math.min(maximum, bounds.bottom + halfHeight + edgeInset),
          }))
          .filter((interval) => interval.start < interval.end)
          .sort((left, right) => left.start - right.start);
        const merged: VerticalInterval[] = [];
        for (const interval of blocked) {
          const previous = merged.at(-1);
          if (previous && interval.start <= previous.end) {
            previous.end = Math.max(previous.end, interval.end);
          } else {
            merged.push({ ...interval });
          }
        }
        const available: VerticalInterval[] = [];
        let cursor = minimum;
        for (const interval of merged) {
          if (interval.start > cursor) available.push({ start: cursor, end: interval.start });
          cursor = Math.max(cursor, interval.end);
        }
        if (cursor < maximum) available.push({ start: cursor, end: maximum });
        if (available.length === 0) return null;

        const targets = boardBounds
          ? [
              boardBounds.top - halfHeight - edgeInset,
              boardBounds.bottom + halfHeight + edgeInset,
            ]
          : [
              surfaceBounds.top + surfaceBounds.height * 0.29,
              surfaceBounds.top + surfaceBounds.height * 0.71,
            ];
        return available.reduce<{ center: number; score: number } | null>((best, interval) => (
          targets.reduce<{ center: number; score: number } | null>((intervalBest, target) => {
            const center = Math.min(interval.end, Math.max(interval.start, target));
            const candidate = { center, score: Math.abs(center - target) };
            if (!intervalBest || candidate.score < intervalBest.score) return candidate;
            return intervalBest;
          }, best)
        ), null)?.center ?? null;
      };

      const safeRail = railWidths.map((width) => ({ width, center: centerForWidth(width) }))
        .find(({ center }) => center !== null);
      const fallbackWidth = railWidths.at(-1) ?? Math.round(widestRail);
      const fallback = [0.29, 0.71, 0.23, 0.77, 0.35, 0.65].map((ratio) => {
        const candidateCenter = surfaceBounds.top + surfaceBounds.height * ratio;
        const candidate: Rectangle = {
          left: surfaceBounds.left + (surfaceBounds.width - fallbackWidth) / 2,
          right: surfaceBounds.left + (surfaceBounds.width + fallbackWidth) / 2,
          top: candidateCenter - railBounds.height / 2,
          bottom: candidateCenter + railBounds.height / 2,
        };
        const escapesSurface = candidate.left < surfaceBounds.left
          || candidate.right > surfaceBounds.right
          || candidate.top < surfaceBounds.top
          || candidate.bottom > surfaceBounds.bottom;
        const collisions = protectedBounds.filter((bounds) => intersects(candidate, bounds)).length;
        return { center: candidateCenter, collisions: collisions + (escapesSurface ? 100 : 0) };
      });
      const fallbackRail = fallback.reduce((current, candidate) => (
        candidate.collisions < current.collisions ? candidate : current
      ));
      const next: SettlementRail = {
        top: Math.round((safeRail?.center ?? fallbackRail.center) - surfaceBounds.top),
        width: safeRail?.width ?? fallbackWidth,
      };
      setRail((current) => (
        current
        && Math.abs(current.top - next.top) < 1
        && Math.abs(current.width - next.width) < 1
          ? current
          : next
      ));
    };

    update();
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(update);
    if (surfaceRef.current && resizeObserver) resizeObserver.observe(surfaceRef.current);
    if (railRef.current && resizeObserver) resizeObserver.observe(railRef.current);
    const animationFrame = typeof window.requestAnimationFrame === 'function'
      ? window.requestAnimationFrame(update)
      : null;
    window.addEventListener('resize', update);
    return () => {
      resizeObserver?.disconnect();
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
      window.removeEventListener('resize', update);
    };
  }, [active]);

  return { surfaceRef, railRef, rail };
};

export const PokerTable = ({ snapshot, pending, onCommand }: PokerTableProps) => {
  const [expandedSeat, setExpandedSeat] = useState<number | null>(null);
  const compactViewport = useMediaQuery('(max-width: 740px)');
  const { surfaceRef, railRef, rail: settlementRail } = useSettlementSafeRail(Boolean(snapshot.settlement));
  const hero = snapshot.players.find((player) => player.memberId === snapshot.heroMemberId);
  const isHost = hero?.isHost ?? false;
  const potTotal = snapshot.pots.reduce((sum, pot) => sum + pot.amount, 0)
    || snapshot.players.reduce((sum, player) => sum + player.streetBet, 0);
  const heroSeat = hero?.seat ?? 0;
  const opponents = snapshot.players.filter((player) => player.memberId !== snapshot.heroMemberId);
  const occupiedSeats = snapshot.players.map((player) => player.seat);
  const tableDensity = tableDensityForPlayerCount(occupiedSeats.length);
  const positionedOpponents = opponents.map((player) => ({
    player,
    position: tablePositionForSeat(player.seat, occupiedSeats, heroSeat),
  }));
  const expandedOpponent = positionedOpponents.find(({ player }) => player.seat === expandedSeat);
  const heroActionLabel = hero && hero.status !== 'folded' ? betActionLabel(hero.lastAction) : null;
  const canRequestRebuy = Boolean(
    hero
    && hero.stack <= snapshot.config.bigBlind
    && !hero.rebuyPending
    && (
      snapshot.phase === 'settlement'
      || snapshot.phase === 'lobby'
      || snapshot.phase === 'paused'
      || ['waiting', 'sitting_out', 'eliminated'].includes(hero.status)
    ),
  );
  const settlementRailStyle = settlementRail === null
    ? undefined
    : {
        '--settlement-rail-top': `${settlementRail.top}px`,
        '--settlement-rail-width': `${settlementRail.width}px`,
      } as CSSProperties;

  useEffect(() => {
    if (expandedSeat !== null && !opponents.some((player) => player.seat === expandedSeat)) setExpandedSeat(null);
  }, [expandedSeat, opponents]);

  useEffect(() => {
    const closeDetails = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpandedSeat(null);
    };
    window.addEventListener('keydown', closeDetails);
    return () => window.removeEventListener('keydown', closeDetails);
  }, []);

  return (
    <section
      className={`table-stage ${compactViewport && expandedOpponent ? 'has-seat-inspector' : ''}`}
      data-testid="poker-table"
      aria-label="德州扑克牌桌"
    >
      <div className="table-utility-bar">
        <div className="hand-identity">
          <span>{snapshot.handId ? `HAND ${snapshot.handId.slice(-6).toUpperCase()}` : 'WAITING'}</span>
          <span>盲注 {snapshot.config.smallBlind}/{snapshot.config.bigBlind}</span>
        </div>
        <div className="fairness-live" title="可验证洗牌状态">
          <ShieldCheck size={15} />
          {snapshot.phase === 'collecting_entropy'
            ? `${snapshot.fairness.contributionsReceived}/${snapshot.fairness.contributionsRequired}`
            : snapshot.fairness.merkleRoot ? '牌组已承诺' : '公平洗牌'}
        </div>
        {isHost && (
          <div className="host-table-tools">
            <button
              className="icon-button"
              type="button"
              disabled={pending}
              title={snapshot.paused ? '继续牌局' : '暂停牌局'}
              onClick={() => void onCommand(snapshot.paused ? 'resume_room' : 'pause_room')}
            >
              {snapshot.paused ? <Play size={17} /> : <Pause size={17} />}
            </button>
            <button
              className="icon-button danger-quiet"
              data-testid="close-room"
              type="button"
              disabled={pending}
              title="关闭房间"
              onClick={() => {
                if (window.confirm('房间会在当前手结算后关闭，是否继续？')) void onCommand('close_room');
              }}
            >
              <XCircle size={17} />
            </button>
          </div>
        )}
      </div>

        <div
          className="poker-table-surface"
          data-player-count={occupiedSeats.length}
          data-table-density={tableDensity}
          ref={surfaceRef}
        >
        <div className="table-rail" aria-hidden="true" />
        <div className="table-felt" aria-hidden="true" />

        {positionedOpponents.map(({ player, position }) => (
          <PlayerSeat
            key={player.memberId}
            player={player}
            position={position}
            playerCount={occupiedSeats.length}
            isHero={false}
            isActing={player.seat === snapshot.actingSeat}
            isButton={player.seat === snapshot.buttonSeat}
            showCards={snapshot.phase === 'playing' || snapshot.phase === 'settlement'}
            expanded={expandedSeat === player.seat}
            showDetails={!compactViewport}
            onToggleDetails={() => setExpandedSeat((seat) => seat === player.seat ? null : player.seat)}
          />
        ))}

          <div className="board-zone">
            <div className="pot-display">
              <span>底池</span>
              <motion.strong key={potTotal} initial={{ scale: 0.84 }} animate={{ scale: 1 }}>
                {potTotal.toLocaleString('zh-CN')}
              </motion.strong>
              {snapshot.pots.length > 1 && <small>{snapshot.pots.length - 1} 个边池</small>}
            </div>
            <div className="community-cards" aria-label="公共牌">
              {Array.from({ length: 5 }, (_, index) => (
                snapshot.communityCards[index]
                ? (
                  <motion.div
                    className="community-card-deal"
                    key={`${snapshot.handId}-${index}-${snapshot.communityCards[index]}`}
                    initial={{ opacity: 0, scale: 0.64, rotateY: -78, y: -34 }}
                    animate={{ opacity: 1, scale: 1, rotateY: 0, y: 0 }}
                    transition={{ type: 'spring', stiffness: 330, damping: 23, delay: index * 0.08 }}
                  >
                    <PlayingCard card={snapshot.communityCards[index]} />
                  </motion.div>
                )
                : <div className="card-placeholder" key={index} aria-hidden="true" />
              ))}
            </div>
          </div>

        {hero && (
          <div className="hero-hand-zone" aria-label="你的手牌与积分">
            {snapshot.holeCards.length > 0 && (
              <div className="hero-hole-cards" aria-label="你的底牌">
                {snapshot.holeCards.map((card, index) => <PlayingCard card={card} key={`${card}-${index}`} />)}
              </div>
            )}
            {heroActionLabel && hero && hero.streetBet > 0 && (
              <span className={`hero-bet-action hero-bet-action--${heroActionLabel.toLowerCase()}`}>
                <small>{heroActionLabel}</small>
                <strong>{hero.streetBet.toLocaleString('zh-CN')}</strong>
              </span>
            )}
            <div className="hero-identity">
              <span><UserRound size={14} /> {hero.nickname}</span>
              <small>座位 {hero.seat + 1}</small>
              <strong><WalletCards size={14} /> {hero.stack.toLocaleString('zh-CN')}</strong>
              <span className="hero-bet-detail">
                本街 {hero.streetBet.toLocaleString('zh-CN')} · 累计 {hero.committed.toLocaleString('zh-CN')}
              </span>
              <span className={`hero-status status-${hero.status}`}>{hero.lastAction || hero.status}</span>
              {hero.seat === snapshot.buttonSeat && <span className="hero-dealer-button">D</span>}
            </div>
            {canRequestRebuy && (
              <button
                className="rebuy-command hero-rebuy-command"
                type="button"
                disabled={pending}
                onClick={() => void onCommand('request_rebuy')}
              >
                <CircleDollarSign size={19} />
                <span>申请借款积分</span>
              </button>
            )}
          </div>
        )}

        <AnimatePresence>
          {snapshot.phase === 'collecting_entropy' && (
            <motion.div className="table-overlay compact-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <LockKeyhole size={22} />
              <strong>正在锁定牌组</strong>
              <span>{snapshot.fairness.contributionsReceived}/{snapshot.fairness.contributionsRequired}</span>
            </motion.div>
          )}
          {snapshot.paused && (
            <motion.div className="table-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <Pause size={24} />
              <strong>牌桌已暂停</strong>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {snapshot.settlement && (
            <div className="settlement-positioner" style={settlementRailStyle}>
              <motion.div ref={railRef} className="settlement-strip" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}>
                <span>本手结算</span>
                <div>
                  {snapshot.settlement.winners.map((winner) => (
                    <strong key={`${winner.memberId}-${winner.amount}`}>
                      {winner.nickname} +{winner.amount.toLocaleString('zh-CN')}
                      {winner.handName && <small>{winner.handName}</small>}
                    </strong>
                  ))}
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </div>

      {compactViewport && expandedOpponent && (
        <SeatDetails
          className="seat-details mobile-seat-inspector"
          player={expandedOpponent.player}
          isButton={expandedOpponent.player.seat === snapshot.buttonSeat}
        />
      )}

      <aside className="table-side-rail" aria-label="牌桌信息">
        <LeaderboardPanel snapshot={snapshot} />
        <RoomLogPanel snapshot={snapshot} />
      </aside>

    </section>
  );
};
