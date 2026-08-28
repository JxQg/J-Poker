export interface TablePosition {
  x: number;
  y: number;
  relativeSeat: number;
}

const orbitLayouts: Record<number, ReadonlyArray<readonly [number, number]>> = {
  2: [[50, 92], [50, 8]],
  3: [[50, 92], [84, 27], [16, 27]],
  4: [[50, 92], [91, 50], [50, 8], [9, 50]],
  5: [[50, 92], [88, 70], [77, 18], [23, 18], [12, 70]],
  6: [[50, 92], [90, 80], [90, 38], [50, 8], [10, 38], [10, 80]],
  7: [[50, 92], [82, 84], [94, 54], [76, 16], [24, 16], [6, 54], [18, 84]],
  8: [[50, 92], [83, 81], [93, 50], [79, 17], [50, 8], [21, 17], [7, 50], [17, 81]],
  9: [[50, 92], [77, 86], [94, 65], [89, 33], [67, 10], [33, 10], [11, 33], [6, 65], [23, 86]],
  10: [[50, 92], [75, 85], [92, 64], [94, 40], [77, 16], [50, 6], [23, 16], [6, 40], [8, 64], [25, 85]],
};

export const tablePositionForSeat = (
  seat: number,
  maxPlayers: number,
  heroSeat: number,
): TablePosition => {
  const layout = orbitLayouts[maxPlayers] ?? orbitLayouts[8]!;
  const relativeSeat = (seat - heroSeat + maxPlayers) % maxPlayers;
  const [x, y] = layout[relativeSeat] ?? layout[0]!;
  return { x, y, relativeSeat };
};
