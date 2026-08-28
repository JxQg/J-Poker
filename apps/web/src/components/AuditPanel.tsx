import { ArrowLeft, CheckCircle2, Download, FileCheck2, FolderOpen, ShieldAlert } from 'lucide-react';
import { motion } from 'motion/react';
import { useRef, useState } from 'react';
import { downloadAuditPackage } from '../lib/api';
import type { AuditVerificationResult } from '../lib/fairness';

interface WorkerResponse {
  id: string;
  ok: boolean;
  result?: AuditVerificationResult;
  error?: string;
}

interface AuditPanelProps {
  roomId: string;
  roomCode: string;
  available: boolean;
  onBack: () => void;
  backLabel?: string;
}

const verifyInWorker = (text: string): Promise<AuditVerificationResult> => new Promise((resolve, reject) => {
  const worker = new Worker(new URL('../workers/audit.worker.ts', import.meta.url), { type: 'module' });
  const id = crypto.randomUUID();
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    if (event.data.id !== id) return;
    worker.terminate();
    if (event.data.ok && event.data.result) resolve(event.data.result);
    else reject(new Error(event.data.error || '审计包验证失败'));
  };
  worker.onerror = () => {
    worker.terminate();
    reject(new Error('审计验证线程启动失败'));
  };
  worker.postMessage({ id, text });
});

export const AuditPanel = ({ roomId, roomCode, available, onBack, backLabel = '返回牌桌' }: AuditPanelProps) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<'idle' | 'downloading' | 'verifying' | 'valid' | 'invalid'>('idle');
  const [result, setResult] = useState<AuditVerificationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const verifyText = async (text: string) => {
    setStatus('verifying');
    setError(null);
    try {
      const nextResult = await verifyInWorker(text);
      setResult(nextResult);
      setStatus(nextResult.valid ? 'valid' : 'invalid');
    } catch (verifyError) {
      setResult(null);
      setStatus('invalid');
      setError(verifyError instanceof Error ? verifyError.message : '审计包验证失败');
    }
  };

  const downloadAndVerify = async () => {
    setStatus('downloading');
    setError(null);
    try {
      const blob = await downloadAuditPackage(roomId);
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = href;
      anchor.download = `river-room-${roomCode}-audit.json`;
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      // Keep the object URL alive until the browser has started the download.
      window.setTimeout(() => URL.revokeObjectURL(href), 1_000);
      await verifyText(await blob.text());
    } catch (downloadError) {
      setStatus('invalid');
      setError(downloadError instanceof Error ? downloadError.message : '审计包下载失败');
    }
  };

  const openLocalFile = async (file?: File) => {
    if (!file) return;
    await verifyText(await file.text());
  };

  return (
    <main className="audit-page">
      <button className="back-button" type="button" onClick={onBack}>
        <ArrowLeft size={18} /> {backLabel}
      </button>
      <motion.section className="audit-console" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <div className="audit-heading">
          <span className="audit-seal"><FileCheck2 size={28} /></span>
          <div>
            <span className="eyebrow">ROOM {roomCode}</span>
            <h1>公平审计</h1>
          </div>
        </div>

        <div className="audit-actions">
          <button
            className="primary-command"
            data-testid="audit-download"
            type="button"
            disabled={!available || status === 'downloading' || status === 'verifying'}
            onClick={() => void downloadAndVerify()}
          >
            <Download size={18} />
            {status === 'downloading' ? '正在下载' : '下载并验证'}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(event) => void openLocalFile(event.target.files?.[0])}
          />
          <button className="secondary-command" type="button" onClick={() => inputRef.current?.click()}>
            <FolderOpen size={18} /> 打开本地审计包
          </button>
        </div>

        <div className={`audit-status audit-${status}`} data-testid="audit-status" role="status">
          {status === 'valid' ? <CheckCircle2 size={22} /> : status === 'invalid' ? <ShieldAlert size={22} /> : <FileCheck2 size={22} />}
          <div>
            <strong>
              {status === 'idle' && (available ? '审计材料已就绪' : '审计材料将在房间关闭后生成')}
              {status === 'downloading' && '正在获取审计材料'}
              {status === 'verifying' && '正在独立复原牌局'}
              {status === 'valid' && '审计通过'}
              {status === 'invalid' && '审计未通过'}
            </strong>
            {error && <span>{error}</span>}
          </div>
        </div>

        {result && (
          <div className="audit-checks">
            {result.checks.map((check) => (
              <div className={check.passed ? 'check-passed' : 'check-failed'} key={check.label}>
                <span>{check.passed ? 'PASS' : 'FAIL'}</span>
                <strong>{check.label}</strong>
                <small>{check.detail}</small>
              </div>
            ))}
          </div>
        )}
      </motion.section>
    </main>
  );
};
