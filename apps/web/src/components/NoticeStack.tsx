import { AlertCircle, CheckCircle2, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

interface NoticeStackProps {
  error: string | null;
  notice: string | null;
  onDismissError: () => void;
  onDismissNotice: () => void;
}

export const NoticeStack = ({ error, notice, onDismissError, onDismissNotice }: NoticeStackProps) => (
  <div className="notice-stack" aria-live="polite">
    <AnimatePresence>
      {error && (
        <motion.div className="notice notice-error" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
          <AlertCircle size={18} />
          <span>{error}</span>
          <button type="button" onClick={onDismissError} aria-label="关闭错误"><X size={16} /></button>
        </motion.div>
      )}
      {notice && (
        <motion.div className="notice notice-success" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
          <CheckCircle2 size={18} />
          <span>{notice}</span>
          <button type="button" onClick={onDismissNotice} aria-label="关闭提示"><X size={16} /></button>
        </motion.div>
      )}
    </AnimatePresence>
  </div>
);
