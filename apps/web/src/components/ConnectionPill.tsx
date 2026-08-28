import { Cloud, CloudOff, LoaderCircle } from 'lucide-react';
import type { ConnectionStatus } from '../lib/protocol';

const labels: Record<ConnectionStatus, string> = {
  idle: '未连接',
  connecting: '连接中',
  connected: '已连接',
  reconnecting: '重连中',
  offline: '离线',
};

export const ConnectionPill = ({ status }: { status: ConnectionStatus }) => {
  const Icon = status === 'connected' ? Cloud : status === 'offline' ? CloudOff : LoaderCircle;
  return (
    <span className={`connection-pill status-${status}`} data-testid="connection-status" role="status">
      <Icon size={15} className={status === 'connecting' || status === 'reconnecting' ? 'spin' : ''} />
      {labels[status]}
    </span>
  );
};
