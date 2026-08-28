import { CircleDollarSign, LockKeyhole, Pause, Play, ShieldCheck, UserRound, WalletCards, XCircle } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { GameSnapshot, RoomCommandType } from '../lib/protocol';
import { tablePositionForSeat } from '../lib/tableLayout';
import { PlayerSeat } from './PlayerSeat';
import { PlayingCard } from './PlayingCard';
import { LeaderboardPanel } from './LeaderboardPanel';
import { RoomLogPanel } from './RoomLogPanel';

interface PokerTableProps {
  snapshot: GameSnapshot;
  pending: boolean;
  onCommand: (type: RoomCommandType, payload?: Record<string, unknown>) => Promise<unknown>;
}

export const PokerTable = ({ snapshot, pending, onCommand }: PokerTableProps) => {
  const hero = snapshot.players.find((player) => player.memberId === snapshot.heroMemberId);
  const isHost = hero?.isHost ?? false;
  const potTotal = snapshot.pots.reduce((sum, pot) => sum + pot.amount, 0)
    || snapshot.players.reduce((sum, player) => sum + player.streetBet, 0);
  const heroSeat = hero?.seat ?? 0;
  const opponents = snapshot.players.filter((player) => player.memberId !== snapshot.heroMemberId);
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

  return (
    <section className="table-stage" data-testid="poker-table" aria-label="德州扑克牌桌">
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

        <div className="poker-table-surface">
        <div className="table-rail" aria-hidden="true" />
        <div className="table-felt" aria-hidden="true" />

        {opponents.map((player) => (
          <PlayerSeat
            key={player.memberId}
            player={player}
            position={tablePositionForSeat(player.seat, snapshot.config.maxPlayers, heroSeat)}
            isHero={false}
            isActing={player.seat === snapshot.actingSeat}
            isButton={player.seat === snapshot.buttonSeat}
            showCards={snapshot.phase === 'playing' || snapshot.phase === 'settlement'}
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
            <div className="hero-hole-cards" aria-label="你的底牌">
              {snapshot.holeCards.map((card, index) => <PlayingCard card={card} key={`${card}-${index}`} />)}
            </div>
            <div className="hero-identity">
              <span><UserRound size={14} /> {hero.nickname}</span>
              <small>座位 {hero.seat + 1}</small>
              <strong><WalletCards size={14} /> {hero.stack.toLocaleString('zh-CN')}</strong>
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
      </div>

      <aside className="table-side-rail" aria-label="牌桌信息">
        <LeaderboardPanel snapshot={snapshot} />
        <RoomLogPanel snapshot={snapshot} />
      </aside>

      <AnimatePresence>
        {snapshot.settlement && (
          <motion.div className="settlement-strip" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
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
        )}
      </AnimatePresence>
    </section>
  );
};
