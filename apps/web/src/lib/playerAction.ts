export type BetActionLabel = 'CALL' | 'RAISE';

export const betActionLabel = (lastAction?: string): BetActionLabel | null => {
  const normalized = lastAction?.trim().toLowerCase() ?? '';
  if (normalized.startsWith('raise') || normalized.includes('加注')) return 'RAISE';
  if (normalized.startsWith('call') || normalized.includes('跟注')) return 'CALL';
  return null;
};
