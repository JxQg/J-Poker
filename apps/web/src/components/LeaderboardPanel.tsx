import { ChevronDown, CircleDollarSign, Crown, Trophy } from 'lucide-react';
import { useState } from 'react';
import type { GameSnapshot } from '../lib/protocol';

interface LeaderboardPanelProps {
  snapshot: GameSnapshot;
}

export const LeaderboardPanel = ({ snapshot }: LeaderboardPanelProps) => {
  const [open, setOpen] = useState(
    () => typeof window !== 'undefined' && window.matchMedia?.('(min-width: 1080px)').matches,
  );
  const rankedPlayers = [...snapshot.players].sort((left, right) => (
    right.rankingScore - left.rankingScore
    || right.stack - left.stack
    || left.seat - right.seat
  ));

  return (
    <aside className={`leaderboard-panel ${open ? 'open' : ''}`} aria-label="积分榜">
      <button
        className="leaderboard-heading"
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span><Trophy size={20} /><span className="panel-heading-label">积分榜</span></span>
        <small>筹码 - 借款</small>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {open && <ol className="leaderboard-list">
        {rankedPlayers.map((player, index) => (
          <li className={player.memberId === snapshot.heroMemberId ? 'hero' : ''} key={player.memberId}>
            <span className="leaderboard-rank">{index + 1}</span>
            <div>
              <strong>{player.nickname}</strong>
              <small>座位 {player.seat + 1}{player.isHost && <Crown size={11} aria-label="房主" />}</small>
            </div>
            <div className="leaderboard-score">
              <strong>{player.rankingScore.toLocaleString('zh-CN')}</strong>
              {player.borrowedTotal > 0 && (
                <small><CircleDollarSign size={11} /> -{player.borrowedTotal.toLocaleString('zh-CN')}</small>
              )}
            </div>
          </li>
        ))}
      </ol>}
    </aside>
  );
};
