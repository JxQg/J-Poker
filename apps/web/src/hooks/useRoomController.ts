import { useCallback, useEffect, useRef, useState } from 'react';
import { createSocketTicket } from '../lib/api';
import { createShuffleContribution } from '../lib/entropy';
import { makeCommand, type CommandAck, type RoomCommand, type RoomCommandType } from '../lib/protocol';
import { RoomSocket } from '../lib/socket';
import { useGameStore } from '../store/gameStore';

const ERROR_MESSAGES: Record<string, string> = {
  STALE_VERSION: '牌局状态已更新，请重试',
  STALE_HAND: '这一手已经结束',
  STALE_TURN: '行动权已经变化',
  ILLEGAL_ACTION: '当前不能执行这个操作',
  INVALID_AMOUNT: '下注金额无效',
  ROOM_PAUSED: '房间已暂停',
  NOT_HOST: '只有房主能执行这个操作',
};

export interface RoomController {
  sendCommand: (type: RoomCommandType, payload?: Record<string, unknown>) => Promise<CommandAck>;
}

export const useRoomController = (): RoomController => {
  const session = useGameStore((state) => state.session);
  const snapshot = useGameStore((state) => state.snapshot);
  const setSnapshot = useGameStore((state) => state.setSnapshot);
  const setConnectionStatus = useGameStore((state) => state.setConnectionStatus);
  const beginCommand = useGameStore((state) => state.beginCommand);
  const completeCommand = useGameStore((state) => state.completeCommand);
  const setError = useGameStore((state) => state.setError);
  const socketRef = useRef(new RoomSocket());
  const reconnectTimerRef = useRef<number | null>(null);
  const snapshotRequestRef = useRef(false);
  const eventVersionRef = useRef(0);
  const submittedEntropyRef = useRef(new Set<string>());
  const entropyAttemptsRef = useRef(new Map<string, number>());
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [entropyRetry, setEntropyRetry] = useState(0);

  const scheduleReconnect = useCallback(() => {
    if (reconnectTimerRef.current !== null) return;
    reconnectTimerRef.current = window.setTimeout(() => {
      reconnectTimerRef.current = null;
      setReconnectAttempt((attempt) => attempt + 1);
    }, 900);
  }, []);

  const requestSnapshot = useCallback(async (socket: RoomSocket): Promise<void> => {
    if (!session || snapshotRequestRef.current) return;
    snapshotRequestRef.current = true;
    const current = useGameStore.getState().snapshot;
    const command: RoomCommand = {
      commandId: crypto.randomUUID(),
      roomId: session.roomId,
      handId: current?.handId ?? null,
      turnId: current?.turnId ?? null,
      expectedVersion: current?.version ?? 0,
      type: 'request_snapshot',
      payload: {},
    };
    try {
      const ack = await socket.send(command);
      if (ack.snapshot) setSnapshot(ack.snapshot);
    } catch (error) {
      setError(error instanceof Error ? error.message : '无法同步房间状态');
    } finally {
      snapshotRequestRef.current = false;
    }
  }, [session, setError, setSnapshot]);

  useEffect(() => {
    if (!session) {
      socketRef.current.disconnect();
      setConnectionStatus('idle');
      return;
    }

    let disposed = false;
    const socket = socketRef.current;
    setConnectionStatus(reconnectAttempt === 0 ? 'connecting' : 'reconnecting');

    void (async () => {
      try {
        const { ticket } = await createSocketTicket(session.roomId);
        if (disposed) return;
        socket.connect(ticket, {
          onConnect: () => {
            setConnectionStatus('connected');
            setError(null);
          },
          onDisconnect: () => {
            if (disposed) return;
            setConnectionStatus(navigator.onLine ? 'reconnecting' : 'offline');
            scheduleReconnect();
          },
          onSnapshot: (nextSnapshot) => {
            eventVersionRef.current = nextSnapshot.version;
            setSnapshot(nextSnapshot);
          },
          onEvent: (event) => {
            const current = useGameStore.getState().snapshot;
            if (event.snapshot) {
              eventVersionRef.current = event.snapshot.version;
              setSnapshot(event.snapshot);
              return;
            }
            if (current && event.version > Math.max(current.version, eventVersionRef.current) + 1) {
              void requestSnapshot(socket);
            }
            eventVersionRef.current = Math.max(eventVersionRef.current, event.version);
          },
          onError: (message) => {
            if (disposed) return;
            setError(message);
            setConnectionStatus('reconnecting');
            scheduleReconnect();
          },
        });
      } catch (error) {
        if (disposed) return;
        setError(error instanceof Error ? error.message : '无法建立实时连接');
        setConnectionStatus(navigator.onLine ? 'reconnecting' : 'offline');
        scheduleReconnect();
      }
    })();

    return () => {
      disposed = true;
      socket.disconnect();
    };
  }, [reconnectAttempt, requestSnapshot, scheduleReconnect, session, setConnectionStatus, setError, setSnapshot]);

  useEffect(() => {
    const online = () => {
      setConnectionStatus('reconnecting');
      scheduleReconnect();
    };
    const offline = () => setConnectionStatus('offline');
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    };
  }, [scheduleReconnect, setConnectionStatus]);

  const sendCommand = useCallback(async (
    type: RoomCommandType,
    payload: Record<string, unknown> = {},
  ): Promise<CommandAck> => {
    const current = useGameStore.getState().snapshot;
    if (!current) throw new Error('房间状态尚未同步');
    if (useGameStore.getState().pendingCommandId) throw new Error('上一项操作仍在确认中');

    const command = makeCommand(current, type, payload);
    beginCommand(command.commandId, type);
    try {
      const ack = await socketRef.current.send(command);
      if (ack.status === 'rejected') {
        throw new Error(ack.message || ERROR_MESSAGES[ack.errorCode ?? ''] || '服务器拒绝了这项操作');
      }
      completeCommand(ack);
      return ack;
    } catch (error) {
      completeCommand();
      const message = error instanceof Error ? error.message : '操作失败';
      setError(message);
      throw error;
    }
  }, [beginCommand, completeCommand, setError]);

  useEffect(() => {
    if (
      !snapshot?.handId
      || snapshot.phase !== 'collecting_entropy'
      || !snapshot.fairness.contributionRequired
      || submittedEntropyRef.current.has(snapshot.handId)
    ) return;
    submittedEntropyRef.current.add(snapshot.handId);
    void sendCommand('contribute_randomness', { entropy: createShuffleContribution() })
      .catch(() => {
        const handId = snapshot.handId ?? '';
        submittedEntropyRef.current.delete(handId);
        const attempts = (entropyAttemptsRef.current.get(handId) ?? 0) + 1;
        entropyAttemptsRef.current.set(handId, attempts);
        if (attempts <= 3) window.setTimeout(() => setEntropyRetry((value) => value + 1), 500 * attempts);
      });
  }, [entropyRetry, sendCommand, snapshot]);

  useEffect(() => () => {
    if (reconnectTimerRef.current !== null) window.clearTimeout(reconnectTimerRef.current);
    socketRef.current.disconnect();
  }, []);

  return { sendCommand };
};
