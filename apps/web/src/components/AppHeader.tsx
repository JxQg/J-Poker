import { Check, Copy, DoorOpen, Scale } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ConnectionPill } from './ConnectionPill';
import type { ConnectionStatus } from '../lib/protocol';
import jPokerIcon from '../assets/j-poker-icon.png';

interface AppHeaderProps {
  roomCode: string;
  connectionStatus: ConnectionStatus;
  auditAvailable: boolean;
  onAudit: () => void;
  onLeave: () => void;
}

export const AppHeader = ({ roomCode, connectionStatus, auditAvailable, onAudit, onLeave }: AppHeaderProps) => {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1_800);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copyInvite = async () => {
    const invite = `${window.location.origin}/r/${roomCode}`;
    await navigator.clipboard.writeText(invite);
    setCopied(true);
  };

  return (
    <header className="app-header">
      <button className="brand-button" type="button" onClick={onLeave} aria-label="返回首页">
        <span className="brand-mark"><img src={jPokerIcon} alt="" /></span>
        <span className="brand-word">J-POKER</span>
      </button>
      <div className="room-identity">
        <span className="room-label">房间</span>
        <strong data-testid="room-code">{roomCode}</strong>
        <button className="icon-button" type="button" onClick={() => void copyInvite()} title="复制邀请链接">
          {copied ? <Check size={17} /> : <Copy size={17} />}
        </button>
      </div>
      <nav className="header-actions" aria-label="房间工具">
        {auditAvailable && (
          <button className="icon-button" data-testid="audit-link" type="button" onClick={onAudit} title="公平审计">
            <Scale size={18} />
          </button>
        )}
        <ConnectionPill status={connectionStatus} />
        <button className="icon-button" type="button" onClick={onLeave} title="离开房间">
          <DoorOpen size={18} />
        </button>
      </nav>
    </header>
  );
};
