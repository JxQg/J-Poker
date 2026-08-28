import { BookOpen, X } from 'lucide-react';

interface PokerTermsDrawerProps {
  open: boolean;
  onClose: () => void;
}

const TERMS = [
  ['跟注 (Call)', '匹配当前最高下注额以继续牌局。'],
  ['跛入 (Limp)', '翻前仅跟 1BB 进入底池。'],
  ['Check', '无需跟注时选择不下注，翻前通常仅大盲可用。'],
  ['VPIP', '主动投入底池的频率，强制盲注不计入。'],
  ['RFI / Open Raise', '无人入池时率先加注。'],
  ['2bet / 3bet / 4bet', '盲注视为 1bet，之后每一次再加注依次递增。'],
  ['偷盲 / 隔离加注', '后位率先加注争夺盲注，或针对跛入玩家加注。'],
  ['最小加注 / 超池下注', '最小加注通常是当前下注额的两倍；超池下注高于底池。'],
  ['All-in / Push', '投入自己所有可用筹码；率先全压也叫 Open Shove。'],
] as const;

export const PokerTermsDrawer = ({ open, onClose }: PokerTermsDrawerProps) => {
  if (!open) return null;

  return (
    <div className="terms-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="poker-terms-drawer"
        aria-label="德州扑克术语"
        aria-modal="true"
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <span><BookOpen size={18} /> 牌桌术语</span>
          <button className="icon-button" type="button" title="关闭术语说明" onClick={onClose}><X size={17} /></button>
        </header>
        <dl>
          {TERMS.map(([term, description]) => (
            <div key={term}>
              <dt>{term}</dt>
              <dd>{description}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
};
