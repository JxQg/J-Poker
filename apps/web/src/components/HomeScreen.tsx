import { ArrowRight, KeyRound, Plus } from 'lucide-react';
import { motion } from 'motion/react';
import { type FormEvent, useMemo, useState } from 'react';
import chipStack from '../assets/chip-stack.svg';
import jPokerIcon from '../assets/j-poker-icon.png';
import { createRoom, joinRoom } from '../lib/api';
import { DEFAULT_ROOM_CONFIG } from '../lib/protocol';
import { useGameStore } from '../store/gameStore';

const ROOM_CODE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{8}$/;

const cleanNickname = (value: string): string => value.trim().replace(/\s+/g, ' ');
const cleanRoomCode = (value: string): string => value
  .toUpperCase()
  .replace(/[^0-9A-HJKMNP-TV-Z]/g, '')
  .slice(0, 8);

interface HomeScreenProps {
  inviteCode?: string;
}

export const HomeScreen = ({ inviteCode = '' }: HomeScreenProps) => {
  const setSession = useGameStore((state) => state.setSession);
  const setGlobalError = useGameStore((state) => state.setError);
  const [createNickname, setCreateNickname] = useState('');
  const [joinNickname, setJoinNickname] = useState('');
  const [roomCode, setRoomCode] = useState(cleanRoomCode(inviteCode));
  const [busy, setBusy] = useState<'create' | 'join' | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const invited = useMemo(() => ROOM_CODE_PATTERN.test(cleanRoomCode(inviteCode)), [inviteCode]);

  const enterRoom = (code: string) => {
    window.history.replaceState({}, '', `/r/${code}`);
  };

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    const nickname = cleanNickname(createNickname);
    if (!nickname || nickname.length > 20) {
      setFormError('昵称需为 1-20 个字符');
      return;
    }
    setBusy('create');
    setFormError(null);
    try {
      const session = await createRoom(nickname, DEFAULT_ROOM_CONFIG);
      setSession(session);
      enterRoom(session.roomCode);
    } catch (error) {
      const message = error instanceof Error ? error.message : '创建房间失败';
      setFormError(message);
      setGlobalError(message);
    } finally {
      setBusy(null);
    }
  };

  const handleJoin = async (event: FormEvent) => {
    event.preventDefault();
    const nickname = cleanNickname(joinNickname);
    const code = cleanRoomCode(roomCode);
    if (!ROOM_CODE_PATTERN.test(code)) {
      setFormError('请输入 8 位房间码');
      return;
    }
    if (!nickname || nickname.length > 20) {
      setFormError('昵称需为 1-20 个字符');
      return;
    }
    setBusy('join');
    setFormError(null);
    try {
      const session = await joinRoom(code, nickname);
      setSession(session);
      enterRoom(session.roomCode);
    } catch (error) {
      const message = error instanceof Error ? error.message : '加入房间失败';
      setFormError(message);
      setGlobalError(message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <main className="home-screen">
      <motion.header
        className="home-brand"
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45 }}
      >
        <div className="home-brand-lockup">
          <span className="brand-mark large"><img src={jPokerIcon} alt="" /></span>
          <div>
            <h1>J-POKER</h1>
            <p>私人德州扑克</p>
          </div>
        </div>
        <img className="home-chip-art" src={chipStack} alt="" />
      </motion.header>

      <motion.div
        className={`entry-grid ${invited ? 'invite-first' : ''}`}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.12, duration: 0.4 }}
      >
        <section className="entry-panel create-panel">
          <div className="entry-panel-heading">
            <span className="section-number">01</span>
            <div>
              <h2>创建牌桌</h2>
              <p>你将成为房主</p>
            </div>
          </div>
          <form onSubmit={(event) => void handleCreate(event)}>
            <label htmlFor="create-nickname">昵称</label>
            <div className="field-with-icon">
              <input
                id="create-nickname"
                data-testid="create-nickname"
                value={createNickname}
                onChange={(event) => setCreateNickname(event.target.value)}
                maxLength={20}
                autoComplete="nickname"
                placeholder="输入你的昵称"
              />
              <Plus size={18} />
            </div>
            <button className="primary-command" data-testid="create-room" type="submit" disabled={busy !== null}>
              {busy === 'create' ? '正在创建' : '创建房间'}
              <ArrowRight size={18} />
            </button>
          </form>
        </section>

        <section className="entry-panel join-panel">
          <div className="entry-panel-heading">
            <span className="section-number">02</span>
            <div>
              <h2>{invited ? '接受邀请' : '加入牌桌'}</h2>
              <p>{invited ? `房间 ${roomCode}` : '使用 8 位房间码'}</p>
            </div>
          </div>
          <form onSubmit={(event) => void handleJoin(event)}>
            <label htmlFor="join-room-code">房间码</label>
            <div className="field-with-icon code-field">
              <input
                id="join-room-code"
                data-testid="join-room-code"
                value={roomCode}
                onChange={(event) => setRoomCode(cleanRoomCode(event.target.value))}
                maxLength={8}
                inputMode="text"
                autoCapitalize="characters"
                autoComplete="off"
                placeholder="00000000"
              />
              <KeyRound size={18} />
            </div>
            <label htmlFor="join-nickname">昵称</label>
            <input
              id="join-nickname"
              data-testid="join-nickname"
              value={joinNickname}
              onChange={(event) => setJoinNickname(event.target.value)}
              maxLength={20}
              autoComplete="nickname"
              placeholder="输入你的昵称"
              autoFocus={invited}
            />
            <button className="secondary-command" data-testid="join-room" type="submit" disabled={busy !== null}>
              {busy === 'join' ? '正在加入' : '加入房间'}
              <ArrowRight size={18} />
            </button>
          </form>
        </section>
      </motion.div>

      <div className="home-meta">
        <span>2-10 人</span>
        <span>无限注</span>
        <span>娱乐筹码</span>
      </div>
      {formError && <p className="form-error" role="alert">{formError}</p>}
    </main>
  );
};
