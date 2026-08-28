import {
  normalizeRoomSession,
  normalizeSocketTicket,
  type RoomConfig,
  type RoomSession,
  type SocketTicket,
} from './protocol';

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const parseBody = async (response: Response): Promise<unknown> => {
  const contentType = response.headers.get('content-type') ?? '';
  return contentType.includes('application/json') ? response.json() : response.text();
};

const request = async (path: string, init?: RequestInit): Promise<unknown> => {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  const body = await parseBody(response);
  if (!response.ok) {
    const detail = typeof body === 'object' && body !== null ? body as Record<string, unknown> : {};
    const message = typeof detail.message === 'string'
      ? detail.message
      : typeof detail.detail === 'string'
        ? detail.detail
        : `请求失败（${response.status}）`;
    const code = typeof detail.errorCode === 'string'
      ? detail.errorCode
      : typeof detail.code === 'string'
        ? detail.code
        : undefined;
    throw new ApiError(message, response.status, code);
  }
  return body;
};

export const createRoom = async (nickname: string, config: RoomConfig): Promise<RoomSession> => {
  const body = await request('/api/v1/rooms', {
    method: 'POST',
    body: JSON.stringify({ nickname, config }),
  });
  return normalizeRoomSession(body, nickname);
};

export const joinRoom = async (roomCode: string, nickname: string): Promise<RoomSession> => {
  const normalizedCode = roomCode.trim().toUpperCase();
  const body = await request(`/api/v1/rooms/${encodeURIComponent(normalizedCode)}/join`, {
    method: 'POST',
    body: JSON.stringify({ nickname }),
  });
  return normalizeRoomSession(body, nickname);
};

export const createSocketTicket = async (roomId: string): Promise<SocketTicket> => {
  const body = await request(`/api/v1/rooms/${encodeURIComponent(roomId)}/socket-ticket`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
  return normalizeSocketTicket(body);
};

export const getAuditDownloadUrl = (roomId: string): string =>
  `${API_BASE}/api/v1/rooms/${encodeURIComponent(roomId)}/audit`;

export const downloadAuditPackage = async (roomId: string): Promise<Blob> => {
  const response = await fetch(getAuditDownloadUrl(roomId), {
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new ApiError(`审计包下载失败（${response.status}）`, response.status);
  return response.blob();
};
