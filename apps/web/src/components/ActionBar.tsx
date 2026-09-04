import { ArrowUp, BookOpen, CheckCircle2, Coins, Flame, LoaderCircle, Minus, Plus, XCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useDeadline } from '../hooks/useDeadline';
import type { CompletedHand, GameSnapshot, RoomCommandType } from '../lib/protocol';
import { PlayingCard } from './PlayingCard';
import { PokerTermsDrawer } from './PokerTermsDrawer';

interface ActionBarProps {
  snapshot: GameSnapshot;
  pending: boolean;
  onCommand: (type: RoomCommandType, payload?: Record<string, unknown>) => Promise<unknown>;
}

interface SettlementSummaryProps {
  hand?: CompletedHand;
  readyAvailable: boolean;
  ready: boolean;
  pending: boolean;
  onReady: () => void;
}

const SettlementSummary = ({ hand, readyAvailable, ready, pending, onReady }: SettlementSummaryProps) => (
  <section className="settlement-summary" aria-label="本手最终牌型">
    <div className="settlement-summary-heading">
      <span>本手摊牌</span>
      {hand && <strong>底池 {hand.pot.toLocaleString('zh-CN')}</strong>}
      {readyAvailable && (
        <button
          className={`settlement-ready-command ${ready ? 'ready' : ''}`}
          data-testid="settlement-ready"
          type="button"
          disabled={pending || ready}
          onClick={onReady}
        >
          <CheckCircle2 size={16} /> {ready ? '已准备下一手' : '准备下一手'}
        </button>
      )}
    </div>
    {hand ? (
      <div className="settlement-summary-list" role="list">
        {[...hand.players].sort((left, right) => left.seat - right.seat).map((player) => {
          const showedDown = !player.folded && player.holeCards.length === 2;
          return (
            <article className={`settlement-summary-player ${player.folded ? 'folded' : ''}`} data-testid={`settlement-player-${player.memberId}`} key={player.memberId} role="listitem">
              <span className="settlement-player-name">#{player.seat + 1} {player.nickname}</span>
              <div className="settlement-player-result">
                {showedDown ? (
                  <>
                    {player.holeCards.map((card, index) => <PlayingCard card={card} compact key={`${card}-${index}`} />)}
                    <strong>{player.handName}</strong>
                  </>
                ) : <small>已弃牌</small>}
              </div>
            </article>
          );
        })}
      </div>
    ) : <p className="settlement-summary-empty">正在整理本手摊牌结果</p>}
  </section>
);

export const ActionBar = ({ snapshot, pending, onCommand }: ActionBarProps) => {
  const legal = snapshot.legalActions;
  const hero = snapshot.players.find((player) => player.memberId === snapshot.heroMemberId);
  const isHeroTurn = hero?.seat === snapshot.actingSeat && snapshot.phase === 'playing';
  const remainingMs = useDeadline(snapshot.deadlineAt, snapshot.serverNow);
  const totalMs = snapshot.config.actionTimeoutSeconds * 1_000;
  const remainingSeconds = remainingMs === null ? null : Math.ceil(remainingMs / 1_000);
  const progress = remainingMs === null ? 0 : Math.max(0, Math.min(100, (remainingMs / totalMs) * 100));
  const minRaise = Math.max(legal.minRaiseTo, snapshot.currentBet + snapshot.config.bigBlind);
  const maxRaise = Math.max(minRaise, legal.maxRaiseTo || hero?.stack || minRaise);
  const [raiseTo, setRaiseTo] = useState(minRaise);
  const [termsOpen, setTermsOpen] = useState(false);
  const raisePresets = [2, 3].map((multiple) => ({ multiple, amount: snapshot.currentBet * multiple }));
  const settledHand = useMemo(() => (
    snapshot.phase === 'settlement'
      ? snapshot.completedHands.find((hand) => hand.handId === snapshot.handId) ?? snapshot.completedHands.at(-1)
      : undefined
  ), [snapshot.completedHands, snapshot.handId, snapshot.phase]);
  const settlementReadyAvailable = Boolean(
    snapshot.phase === 'settlement'
    && hero
    && !hero.managed
    && !hero.leavePending
    && hero.status !== 'folded',
  );
  const raiseMultiplier = snapshot.currentBet > 0 && raiseTo > 0
    ? `${(raiseTo / snapshot.currentBet).toFixed(1).replace(/\.0$/, '')}X`
    : '';

  useEffect(() => setRaiseTo(minRaise), [minRaise, snapshot.turnId]);

  const waitingLabel = useMemo(() => {
    if (snapshot.phase === 'collecting_entropy') return '正在生成可验证牌组';
    if (snapshot.paused) return '牌桌已暂停';
    if (snapshot.phase === 'settlement') return '正在结算，本手即将开始';
    if (hero?.status === 'managed') return '网络断开，已进入托管';
    if (hero?.status === 'leaving') return '离房请求已记录，本手结算后移除';
    if (hero && hero.stack <= snapshot.config.bigBlind && snapshot.handId === null) return '筹码不足，等待补充后入场';
    if (snapshot.lateJoin || hero?.status === 'sitting_out') return '你将在下一手加入';
    const acting = snapshot.players.find((player) => player.seat === snapshot.actingSeat);
    return acting ? `等待 ${acting.nickname} 行动` : '等待牌局更新';
  }, [hero, snapshot]);

  const act = (action: 'fold' | 'check' | 'call', amount?: number) =>
    onCommand('player_action', amount === undefined ? { action } : { action, amount });
  const adjustRaise = (direction: -1 | 1) => {
    const step = snapshot.config.bigBlind;
    setRaiseTo((value) => Math.min(maxRaise, Math.max(minRaise, value + direction * step)));
  };

  return (
    <>
      <section className={`action-dock ${isHeroTurn ? 'your-turn' : ''}`} aria-label="玩家操作">
      <div className="turn-timer" aria-label={remainingSeconds === null ? '无行动倒计时' : `剩余 ${remainingSeconds} 秒`}>
        <span style={{ width: `${progress}%` }} className={remainingSeconds !== null && remainingSeconds <= 8 ? 'urgent' : ''} />
      </div>
      {snapshot.phase === 'settlement' ? (
        <SettlementSummary
          hand={settledHand}
          pending={pending}
          ready={hero?.settlementReady ?? false}
          readyAvailable={settlementReadyAvailable}
          onReady={() => void onCommand('set_settlement_ready', { ready: true })}
        />
      ) : !isHeroTurn ? (
        <div className="waiting-action-state">
          <span className="waiting-pulse" aria-hidden="true" />
          <strong>{waitingLabel}</strong>
          {remainingSeconds !== null && <span>{remainingSeconds}s</span>}
        </div>
      ) : (
        <div className="action-content">
          <div className="action-status">
            <span>轮到你</span>
            <strong>{remainingSeconds ?? snapshot.config.actionTimeoutSeconds}s</strong>
            <button className="terms-command" type="button" title="牌桌术语" onClick={() => setTermsOpen(true)}>
              <BookOpen size={15} />
            </button>
          </div>
          <div className="action-modules">
            <div className="basic-actions">
              <button
                className="action-button fold-action"
                data-testid="action-fold"
                type="button"
                disabled={pending || !legal.canFold}
                onClick={() => void act('fold')}
              >
                <XCircle size={18} /> 弃牌
              </button>
              <button
                className="action-button check-action"
                data-testid="action-check"
                type="button"
                disabled={pending || !legal.canCheck}
                onClick={() => void act('check')}
              >
                <CheckCircle2 size={18} /> 过牌
              </button>
              <button
                className="action-button call-action"
                data-testid="action-call"
                type="button"
                disabled={pending || !legal.canCall}
                onClick={() => void act('call', legal.callAmount)}
              >
                <Coins size={18} /> 跟注 {legal.callAmount > 0 ? legal.callAmount : ''}
              </button>
              <button
                className="action-button call-action raise-action"
                type="button"
                aria-label={`加注 ${raiseMultiplier || '金额'}`}
                disabled={pending || !legal.canRaise}
                onClick={() => void onCommand('player_action', { action: 'raise_to', amount: raiseTo })}
              >
                <ArrowUp size={18} /> 加注{raiseMultiplier && ` ${raiseMultiplier}`}
              </button>
            </div>
            <div className="raise-control">
              <label htmlFor="raise-to">调节加注总额</label>
              <input
                id="raise-to"
                type="range"
                min={minRaise}
                max={maxRaise}
                step={snapshot.config.bigBlind}
                value={Math.min(raiseTo, maxRaise)}
                disabled={pending || !legal.canRaise}
                onChange={(event) => setRaiseTo(Number(event.target.value))}
              />
              <div className="raise-controls-row">
                <div className="raise-presets" aria-label="加注倍率">
                  {raisePresets.map(({ multiple, amount }) => (
                    <button
                      type="button"
                      key={multiple}
                      className={raiseTo === amount ? 'selected' : ''}
                      disabled={pending || !legal.canRaise || snapshot.currentBet <= 0 || amount < minRaise || amount > maxRaise}
                      onClick={() => setRaiseTo(amount)}
                    >
                      {multiple}X
                    </button>
                  ))}
                </div>
                <div className="raise-amount-control">
                  <button className="raise-step-button" type="button" aria-label="减少加注" disabled={pending || !legal.canRaise || raiseTo <= minRaise} onClick={() => adjustRaise(-1)}>
                    <Minus size={16} />
                  </button>
                  <input
                    className="raise-amount"
                    aria-label="加注总额"
                    type="number"
                    min={minRaise}
                    max={maxRaise}
                    step={snapshot.config.bigBlind}
                    value={raiseTo}
                    disabled={pending || !legal.canRaise}
                    onChange={(event) => setRaiseTo(Math.min(maxRaise, Math.max(minRaise, Number(event.target.value))))}
                  />
                  <button className="raise-step-button" type="button" aria-label="增加加注" disabled={pending || !legal.canRaise || raiseTo >= maxRaise} onClick={() => adjustRaise(1)}>
                    <Plus size={16} />
                  </button>
                </div>
              </div>
            </div>
            <button
              className="all-in-action"
              data-testid="action-showhand"
              type="button"
              title="SHOWHAND 全下"
              disabled={pending || !legal.canAllIn}
              onClick={() => void onCommand(
                'player_action',
                legal.canRaise ? { action: 'raise_to', amount: maxRaise } : { action: 'call' },
              )}
            >
              <Flame size={18} fill="currentColor" /> SHOWHAND
            </button>
          </div>
        </div>
      )}
      {pending && (
        <div className="pending-ack" role="status">
          <LoaderCircle className="spin" size={18} /> 等待服务器确认
        </div>
      )}
      </section>
      <PokerTermsDrawer open={termsOpen} onClose={() => setTermsOpen(false)} />
    </>
  );
};
