import { useEffect, useState } from 'react';

export const useDeadline = (deadlineAt: string | null, serverNow: string): number | null => {
  const [remainingMs, setRemainingMs] = useState<number | null>(null);

  useEffect(() => {
    if (!deadlineAt) {
      setRemainingMs(null);
      return;
    }
    const initialRemaining = Math.max(0, Date.parse(deadlineAt) - Date.parse(serverNow));
    const receivedAt = Date.now();
    const update = () => setRemainingMs(Math.max(0, initialRemaining - (Date.now() - receivedAt)));
    update();
    const timer = window.setInterval(update, 200);
    return () => window.clearInterval(timer);
  }, [deadlineAt, serverNow]);

  return remainingMs;
};
