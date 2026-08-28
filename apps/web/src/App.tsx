import { LoaderCircle, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActionBar } from './components/ActionBar';
import { AppHeader } from './components/AppHeader';
import { AuditPanel } from './components/AuditPanel';
import { HomeScreen } from './components/HomeScreen';
import { Lobby } from './components/Lobby';
import { NoticeStack } from './components/NoticeStack';
import { PokerTable } from './components/PokerTable';
import { useRoomController } from './hooks/useRoomController';
import type { RoomCommandType } from './lib/protocol';
import { useGameStore } from './store/gameStore';

const routeState = (): { inviteCode?: string; audit: boolean } => {
  const match = window.location.pathname.match(/^\/r\/([0-9A-HJKMNP-TV-Z]{8})(\/audit)?\/?$/i);
  return match ? { inviteCode: match[1]?.toUpperCase(), audit: Boolean(match[2]) } : { audit: false };
};

export default function App() {
  const session = useGameStore((state) => state.session);
  const snapshot = useGameStore((state) => state.snapshot);
  const connectionStatus = useGameStore((state) => state.connectionStatus);
  const pending = useGameStore((state) => Boolean(state.pendingCommandId));
  const error = useGameStore((state) => state.error);
  const notice = useGameStore((state) => state.notice);
  const clearSession = useGameStore((state) => state.clearSession);
  const setError = useGameStore((state) => state.setError);
  const setNotice = useGameStore((state) => state.setNotice);
  const controller = useRoomController();
  const [route, setRoute] = useState(routeState);

  useEffect(() => {
    const updateRoute = () => setRoute(routeState());
    window.addEventListener('popstate', updateRoute);
    return () => window.removeEventListener('popstate', updateRoute);
  }, []);

  useEffect(() => {
    if (session && route.inviteCode && route.inviteCode !== session.roomCode) clearSession();
  }, [clearSession, route.inviteCode, session]);

  const dispatchCommand = useCallback(async (
    type: RoomCommandType,
    payload: Record<string, unknown> = {},
  ): Promise<void> => {
    try {
      await controller.sendCommand(type, payload);
      if (type === 'update_config') setNotice('牌桌设置已更新');
    } catch {
      // The controller exposes rejected commands through the shared notice layer.
    }
  }, [controller, setNotice]);

  const leaveRoom = useCallback(() => {
    clearSession();
    window.history.replaceState({}, '', '/');
    setRoute({ audit: false });
  }, [clearSession]);

  const openAudit = useCallback(() => {
    if (!session) return;
    window.history.pushState({}, '', `/r/${session.roomCode}/audit`);
    setRoute({ inviteCode: session.roomCode, audit: true });
  }, [session]);

  const closeAudit = useCallback(() => {
    if (!session) return;
    window.history.pushState({}, '', `/r/${session.roomCode}`);
    setRoute({ inviteCode: session.roomCode, audit: false });
  }, [session]);

  const auditAvailable = useMemo(
    () => snapshot?.fairness.auditAvailable === true || snapshot?.phase === 'closed',
    [snapshot],
  );

  if (!session) {
    return (
      <div className="app-shell entry-app">
        <HomeScreen inviteCode={route.inviteCode} />
        <NoticeStack error={error} notice={notice} onDismissError={() => setError(null)} onDismissNotice={() => setNotice(null)} />
      </div>
    );
  }

  if (snapshot?.phase === 'closed' || route.audit) {
    return (
      <div className="app-shell room-app">
        <AppHeader
          roomCode={session.roomCode}
          connectionStatus={connectionStatus}
          auditAvailable={auditAvailable}
          onAudit={openAudit}
          onLeave={leaveRoom}
        />
        <AuditPanel
          roomId={session.roomId}
          roomCode={session.roomCode}
          available={auditAvailable}
          onBack={snapshot?.phase === 'closed' ? leaveRoom : closeAudit}
          backLabel={snapshot?.phase === 'closed' ? '返回首页' : '返回牌桌'}
        />
        <NoticeStack error={error} notice={notice} onDismissError={() => setError(null)} onDismissNotice={() => setNotice(null)} />
      </div>
    );
  }

  return (
    <div className="app-shell room-app">
      <AppHeader
        roomCode={session.roomCode}
        connectionStatus={connectionStatus}
        auditAvailable={auditAvailable}
        onAudit={openAudit}
        onLeave={leaveRoom}
      />
      {!snapshot ? (
        <main className="room-loading">
          <LoaderCircle className="spin" size={32} />
          <strong>{connectionStatus === 'offline' ? '网络已断开' : '正在恢复牌桌'}</strong>
          <span>{session.roomCode}</span>
          {connectionStatus === 'offline' && (
            <button className="secondary-command" type="button" onClick={() => window.location.reload()}>
              <RefreshCw size={18} /> 重试
            </button>
          )}
        </main>
      ) : snapshot.phase === 'lobby' ? (
        <Lobby snapshot={snapshot} pending={pending} onCommand={dispatchCommand} />
      ) : (
        <main className="game-layout">
          <PokerTable snapshot={snapshot} pending={pending} onCommand={dispatchCommand} />
          <ActionBar snapshot={snapshot} pending={pending} onCommand={dispatchCommand} />
        </main>
      )}
      <NoticeStack error={error} notice={notice} onDismissError={() => setError(null)} onDismissNotice={() => setNotice(null)} />
    </div>
  );
}
