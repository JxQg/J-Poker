export interface TablePosition {
  x: number;
  y: number;
  relativeSeat: number;
  detailPlacement: SeatDetailPlacement;
}

export type SeatDetailPlacement = 'top' | 'bottom' | 'left' | 'right';

export type TableDensity = 'roomy' | 'standard' | 'compact' | 'dense';

const orbitLayouts: Record<number, ReadonlyArray<readonly [number, number]>> = {
  2: [[50, 84], [50, 16]],
  3: [[50, 84], [82, 24], [18, 24]],
  4: [[50, 84], [88, 50], [50, 16], [12, 50]],
  5: [[50, 84], [86, 70], [76, 22], [24, 22], [14, 70]],
  6: [[50, 84], [88, 70], [88, 42], [50, 16], [12, 42], [12, 70]],
  7: [[50, 84], [82, 70], [90, 48], [76, 20], [24, 20], [10, 48], [18, 70]],
  8: [[50, 84], [84, 68], [99, 43], [76, 19], [50, 15], [24, 19], [1, 43], [16, 68]],
  9: [[50, 84], [80, 70], [92, 57], [90, 36], [70, 17], [30, 17], [10, 36], [8, 57], [20, 70]],
  10: [[50, 84], [78, 70], [92, 56], [91, 36], [74, 17], [50, 14], [26, 17], [9, 36], [8, 56], [22, 70]],
};

export const tableDensityForPlayerCount = (playerCount: number): TableDensity => {
  if (playerCount <= 4) return 'roomy';
  if (playerCount <= 6) return 'standard';
  if (playerCount <= 8) return 'compact';
  return 'dense';
};

const detailPlacementForPosition = (x: number, y: number): SeatDetailPlacement => {
  if (y <= 25) return 'bottom';
  if (y >= 66) return x < 50 ? 'right' : 'left';
  if (x <= 15) return 'right';
  if (x >= 85) return 'left';
  return y < 50 ? 'top' : 'bottom';
};

export const tablePositionForSeat = (
  seat: number,
  occupiedSeats: readonly number[],
  heroSeat: number,
): TablePosition => {
  const orderedSeats = [...occupiedSeats].sort((left, right) => left - right);
  const playerCount = Math.min(10, Math.max(2, orderedSeats.length));
  const layout = orbitLayouts[playerCount] ?? orbitLayouts[8]!;
  const heroIndex = orderedSeats.indexOf(heroSeat);
  const seatIndex = orderedSeats.indexOf(seat);
  const relativeSeat = (seatIndex - heroIndex + playerCount) % playerCount;
  const [x, y] = layout[relativeSeat] ?? layout[0]!;
  return { x, y, relativeSeat, detailPlacement: detailPlacementForPosition(x, y) };
};
