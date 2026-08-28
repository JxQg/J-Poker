/// <reference lib="webworker" />

import { verifyAuditPackage } from '../lib/fairness';

interface VerifyRequest {
  id: string;
  text: string;
}

self.addEventListener('message', (event: MessageEvent<VerifyRequest>) => {
  const { id, text } = event.data;
  void (async () => {
    try {
      const result = await verifyAuditPackage(JSON.parse(text) as unknown);
      self.postMessage({ id, ok: true, result });
    } catch (error) {
      self.postMessage({
        id,
        ok: false,
        error: error instanceof Error ? error.message : '审计包验证失败',
      });
    }
  })();
});

export {};
