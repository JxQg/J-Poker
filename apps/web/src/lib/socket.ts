import { io, type Socket } from 'socket.io-client';
import {
  normalizeAck,
  normalizeRoomEvent,
  normalizeSnapshot,
  type CommandAck,
  type GameSnapshot,
  type RoomCommand,
  type RoomEvent,
} from './protocol';

interface ServerToClientEvents {
  'room:snapshot': (payload: unknown) => void;
  'room:event': (payload: unknown) => void;
  'room:error': (payload: unknown) => void;
}

interface ClientToServerEvents {
  'room:command': (command: RoomCommand, acknowledge: (payload: unknown) => void) => void;
}

export interface RoomSocketHandlers {
  onConnect: () => void;
  onDisconnect: (reason: string) => void;
  onSnapshot: (snapshot: GameSnapshot) => void;
  onEvent: (event: RoomEvent) => void;
  onError: (message: string) => void;
}

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL ?? undefined;

export class RoomSocket {
  private socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;

  connect(ticket: string, handlers: RoomSocketHandlers): void {
    this.disconnect();
    const socket = io(SOCKET_URL, {
      path: '/socket.io',
      auth: { ticket },
      transports: ['websocket', 'polling'],
      reconnection: false,
      timeout: 8_000,
      withCredentials: true,
    });
    this.socket = socket;

    socket.on('connect', handlers.onConnect);
    socket.on('disconnect', handlers.onDisconnect);
    socket.on('connect_error', (error) => handlers.onError(error.message || '实时连接失败'));
    socket.on('room:snapshot', (payload) => {
      try {
        handlers.onSnapshot(normalizeSnapshot(payload));
      } catch (error) {
        handlers.onError(error instanceof Error ? error.message : '无法解析房间状态');
      }
    });
    socket.on('room:event', (payload) => {
      try {
        handlers.onEvent(normalizeRoomEvent(payload));
      } catch (error) {
        handlers.onError(error instanceof Error ? error.message : '无法解析房间事件');
      }
    });
    socket.on('room:error', (payload) => {
      const source = typeof payload === 'object' && payload !== null ? payload as Record<string, unknown> : {};
      handlers.onError(typeof source.message === 'string' ? source.message : '房间连接发生错误');
    });
  }

  send(command: RoomCommand, timeoutMs = 8_000): Promise<CommandAck> {
    const socket = this.socket;
    if (!socket?.connected) return Promise.reject(new Error('实时连接尚未恢复'));

    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('操作确认超时，请检查网络连接')), timeoutMs);
      socket.emit('room:command', command, (payload) => {
        window.clearTimeout(timer);
        try {
          resolve(normalizeAck(payload, command.commandId));
        } catch (error) {
          reject(error instanceof Error ? error : new Error('无法解析操作确认'));
        }
      });
    });
  }

  disconnect(): void {
    this.socket?.removeAllListeners();
    this.socket?.disconnect();
    this.socket = null;
  }
}
