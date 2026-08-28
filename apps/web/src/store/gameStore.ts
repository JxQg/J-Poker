import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CommandAck, ConnectionStatus, GameSnapshot, RoomSession } from '../lib/protocol';

interface GameStoreState {
  session: RoomSession | null;
  snapshot: GameSnapshot | null;
  connectionStatus: ConnectionStatus;
  pendingCommandId: string | null;
  pendingCommandType: string | null;
  error: string | null;
  notice: string | null;
  setSession: (session: RoomSession) => void;
  clearSession: () => void;
  setSnapshot: (snapshot: GameSnapshot) => void;
  setConnectionStatus: (status: ConnectionStatus) => void;
  beginCommand: (commandId: string, commandType: string) => void;
  completeCommand: (ack?: CommandAck) => void;
  setError: (message: string | null) => void;
  setNotice: (message: string | null) => void;
}

export const useGameStore = create<GameStoreState>()(
  persist(
    (set) => ({
      session: null,
      snapshot: null,
      connectionStatus: 'idle',
      pendingCommandId: null,
      pendingCommandType: null,
      error: null,
      notice: null,
      setSession: (session) => set({
        session,
        snapshot: null,
        connectionStatus: 'connecting',
        error: null,
        notice: null,
      }),
      clearSession: () => set({
        session: null,
        snapshot: null,
        connectionStatus: 'idle',
        pendingCommandId: null,
        pendingCommandType: null,
        error: null,
        notice: null,
      }),
      setSnapshot: (snapshot) => set((state) => {
        if (state.snapshot?.roomId === snapshot.roomId && state.snapshot.version > snapshot.version) return state;
        return { snapshot, error: null };
      }),
      setConnectionStatus: (connectionStatus) => set({ connectionStatus }),
      beginCommand: (pendingCommandId, pendingCommandType) => set({
        pendingCommandId,
        pendingCommandType,
        error: null,
      }),
      completeCommand: (ack) => set((state) => ({
        pendingCommandId: null,
        pendingCommandType: null,
        snapshot: ack?.snapshot && (!state.snapshot || ack.snapshot.version >= state.snapshot.version)
          ? ack.snapshot
          : state.snapshot,
      })),
      setError: (error) => set({ error }),
      setNotice: (notice) => set({ notice }),
    }),
    {
      name: 'river-room-session',
      partialize: (state) => ({ session: state.session }),
    },
  ),
);
