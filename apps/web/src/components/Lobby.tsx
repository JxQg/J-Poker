import { CircleDollarSign, Crown, Play, Save, ShieldCheck, Trash2, UserRound, Users } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import type { GameSnapshot, RoomConfig, RoomCommandType } from '../lib/protocol';

interface LobbyProps {
  snapshot: GameSnapshot;
  pending: boolean;
  onCommand: (type: RoomCommandType, payload?: Record<string, unknown>) => Promise<unknown>;
}

export const Lobby = ({ snapshot, pending, onCommand }: LobbyProps) => {
  const hero = snapshot.players.find((player) => player.memberId === snapshot.heroMemberId);
  const isHost = hero?.isHost ?? false;
  const [config, setConfig] = useState<RoomConfig>(snapshot.config);
  const [configError, setConfigError] = useState<string | null>(null);

  useEffect(() => setConfig(snapshot.config), [snapshot.config]);

  const readyPlayers = useMemo(() => snapshot.players.filter((player) => player.ready), [snapshot.players]);
  const canStart = isHost && readyPlayers.length >= 2 && !pending;
  const canRequestRebuy = Boolean(
    hero
    && hero.stack <= snapshot.config.bigBlind
    && !hero.rebuyPending
    && snapshot.handId === null,
  );

  const patchConfig = <TKey extends keyof RoomConfig>(key: TKey, value: RoomConfig[TKey]) => {
    setConfig((current) => ({ ...current, [key]: value }));
  };

  const saveConfig = async () => {
    if (config.bigBlind <= config.smallBlind) {
      setConfigError('大盲必须高于小盲');
      return;
    }
    if (config.initialStack < config.bigBlind * 20 || config.initialStack > config.bigBlind * 500) {
      setConfigError('初始筹码需为 20-500 个大盲');
      return;
    }
    setConfigError(null);
    await onCommand('update_config', { config });
  };

  return (
    <main className="lobby-layout">
      <section className="lobby-roster" aria-labelledby="roster-title">
        <div className="section-heading-row">
          <div>
            <span className="eyebrow">LOBBY</span>
            <h1 id="roster-title">牌桌成员</h1>
          </div>
          <span className="player-count"><Users size={17} /> {snapshot.players.length}/{snapshot.config.maxPlayers}</span>
        </div>

        {snapshot.lateJoin && (
          <div className="late-join-banner">
            <ShieldCheck size={18} />
            <span>已入座，将从下一手开始</span>
          </div>
        )}

        <div className="player-list" data-testid="player-list">
          {Array.from({ length: snapshot.config.maxPlayers }, (_, seat) => {
            const player = snapshot.players.find((item) => item.seat === seat);
            return (
              <motion.div
                className={`lobby-player ${player ? 'occupied' : 'empty'}`}
                key={seat}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(seat * 0.035, 0.2) }}
              >
                <span className="seat-index">{String(seat + 1).padStart(2, '0')}</span>
                <span className="avatar-small"><UserRound size={18} /></span>
                <div className="player-line">
                  <strong data-testid={player ? 'player-name' : undefined}>{player?.nickname ?? '空座位'}</strong>
                  {player && (
                    <span>{player.ready ? '已准备' : player.online ? '未准备' : '已离线'}</span>
                  )}
                </div>
                {player?.isHost && <Crown className="host-crown" size={17} aria-label="房主" />}
                {isHost && player && !player.isHost && (
                  <button
                    className="icon-button danger-quiet"
                    type="button"
                    title={`移除 ${player.nickname}`}
                    disabled={pending}
                    onClick={() => void onCommand('remove_player', { memberId: player.memberId })}
                  >
                    <Trash2 size={16} />
                  </button>
                )}
                {player && <span className={`ready-light ${player.ready ? 'on' : ''}`} aria-hidden="true" />}
              </motion.div>
            );
          })}
        </div>

        <div className="lobby-primary-actions">
          <button
            className={hero?.ready ? 'secondary-command ready-active' : 'secondary-command'}
            data-testid="ready-toggle"
            type="button"
            disabled={pending || !hero}
            onClick={() => void onCommand('set_ready', { ready: !hero?.ready })}
          >
            <ShieldCheck size={19} />
            {hero?.ready ? '取消准备' : '准备'}
          </button>
          {isHost && (
            <button
              className="primary-command"
              data-testid="start-game"
              type="button"
              disabled={!canStart}
              onClick={() => void onCommand('start_hand')}
            >
              <Play size={19} fill="currentColor" />
              开始第一手
            </button>
          )}
        </div>
        {canRequestRebuy && (
          <button
            className="rebuy-command lobby-rebuy-command"
            type="button"
            disabled={pending}
            onClick={() => void onCommand('request_rebuy')}
          >
            <CircleDollarSign size={17} /> 申请借款积分
          </button>
        )}
        {isHost && readyPlayers.length < 2 && <p className="quiet-status">至少 2 名玩家准备后可以开局</p>}
      </section>

      <aside className="room-settings" aria-labelledby="settings-title">
        <div className="settings-title-row">
          <div>
            <span className="eyebrow">TABLE RULES</span>
            <h2 id="settings-title">牌桌设置</h2>
          </div>
          {isHost && <span className="host-label"><Crown size={15} /> 房主</span>}
        </div>

        <fieldset disabled={!isHost || pending}>
          <label htmlFor="max-players">座位数</label>
          <select
            id="max-players"
            value={config.maxPlayers}
            onChange={(event) => patchConfig('maxPlayers', Number(event.target.value))}
          >
            {Array.from({ length: 9 }, (_, index) => index + 2).map((value) => (
              <option value={value} key={value}>{value} 人</option>
            ))}
          </select>

          <div className="two-fields">
            <div>
              <label htmlFor="small-blind">小盲</label>
              <input
                id="small-blind"
                type="number"
                min={1}
                max={5_000}
                value={config.smallBlind}
                onChange={(event) => patchConfig('smallBlind', Math.max(1, Number(event.target.value)))}
              />
            </div>
            <div>
              <label htmlFor="big-blind">大盲</label>
              <input
                id="big-blind"
                type="number"
                min={2}
                max={10_000}
                value={config.bigBlind}
                onChange={(event) => patchConfig('bigBlind', Math.max(2, Number(event.target.value)))}
              />
            </div>
          </div>

          <label htmlFor="initial-stack">初始筹码</label>
          <input
            id="initial-stack"
            type="number"
            min={config.bigBlind * 20}
            max={config.bigBlind * 500}
            step={config.bigBlind}
            value={config.initialStack}
            onChange={(event) => patchConfig('initialStack', Math.max(1, Number(event.target.value)))}
          />
          <span className="field-suffix">{Math.round(config.initialStack / config.bigBlind)} BB</span>

          <label htmlFor="action-timeout">行动时间</label>
          <div className="segmented-control" id="action-timeout">
            {([15, 30, 60] as const).map((value) => (
              <button
                type="button"
                className={config.actionTimeoutSeconds === value ? 'active' : ''}
                key={value}
                onClick={() => patchConfig('actionTimeoutSeconds', value)}
              >
                {value}s
              </button>
            ))}
          </div>
        </fieldset>

        {configError && <p className="form-error compact" role="alert">{configError}</p>}
        {isHost ? (
          <button className="settings-save" type="button" disabled={pending} onClick={() => void saveConfig()}>
            <Save size={17} /> 保存设置
          </button>
        ) : (
          <p className="quiet-status">设置由房主管理，首手开始后锁定</p>
        )}

        {isHost && (
          <button
            className="danger-command"
            data-testid="close-room"
            type="button"
            disabled={pending}
            onClick={() => {
              if (window.confirm('确认关闭这个房间？')) void onCommand('close_room');
            }}
          >
            关闭房间
          </button>
        )}
      </aside>
    </main>
  );
};
