import Ajv from 'ajv';

export type RoomPhase =
  | 'lobby'
  | 'collecting_entropy'
  | 'playing'
  | 'settlement'
  | 'paused'
  | 'closed';

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'offline';
export type PlayerStatus = 'waiting' | 'active' | 'folded' | 'all_in' | 'sitting_out' | 'eliminated';
export type CardCode = `${string}${'c' | 'd' | 'h' | 's'}`;

export interface RoomConfig {
  maxPlayers: number;
  smallBlind: number;
  bigBlind: number;
  initialStack: number;
  actionTimeoutSeconds: 15 | 30 | 60;
}

export interface RoomSession {
  roomId: string;
  roomCode: string;
  memberId: string;
  nickname: string;
}

export interface PlayerState {
  memberId: string;
  nickname: string;
  seat: number;
  stack: number;
  borrowedTotal: number;
  rankingScore: number;
  streetBet: number;
  committed: number;
  status: PlayerStatus;
  ready: boolean;
  online: boolean;
  isHost: boolean;
  rebuyPending: boolean;
  holeCards?: CardCode[];
  lastAction?: string;
}

export interface LegalActions {
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  canRaise: boolean;
  canAllIn: boolean;
  callAmount: number;
  minRaiseTo: number;
  maxRaiseTo: number;
}

export interface PotState {
  amount: number;
  eligibleMemberIds: string[];
}

export interface WinnerState {
  memberId: string;
  nickname: string;
  amount: number;
  handName?: string;
}

export interface SettlementState {
  winners: WinnerState[];
  reason?: string;
}

export interface CompletedHandPlayer {
  memberId: string;
  nickname: string;
  seat: number;
  holeCards: CardCode[];
  handName: string;
  delta: number;
  folded: boolean;
}

export interface CompletedHand {
  handId: string;
  handNumber: number;
  completedAt: string;
  board: CardCode[];
  pot: number;
  players: CompletedHandPlayer[];
}

export interface RoomLogEntry {
  id: string;
  type: string;
  message: string;
  createdAt: string;
  handId?: string;
}

export interface FairnessState {
  serverCommitment?: string;
  merkleRoot?: string;
  contributionsReceived: number;
  contributionsRequired: number;
  contributionRequired: boolean;
  auditAvailable: boolean;
}

export interface GameSnapshot {
  roomId: string;
  roomCode: string;
  version: number;
  handId: string | null;
  turnId: string | null;
  phase: RoomPhase;
  config: RoomConfig;
  players: PlayerState[];
  buttonSeat: number | null;
  actingSeat: number | null;
  communityCards: CardCode[];
  holeCards: CardCode[];
  pots: PotState[];
  currentBet: number;
  legalActions: LegalActions;
  deadlineAt: string | null;
  serverNow: string;
  heroMemberId: string;
  lateJoin: boolean;
  paused: boolean;
  closePending: boolean;
  settlement?: SettlementState;
  roomLogs: RoomLogEntry[];
  completedHands: CompletedHand[];
  fairness: FairnessState;
}

export type RoomCommandType =
  | 'set_ready'
  | 'update_config'
  | 'start_hand'
  | 'contribute_randomness'
  | 'player_action'
  | 'pause_room'
  | 'resume_room'
  | 'remove_player'
  | 'close_room'
  | 'request_rebuy'
  | 'request_snapshot';

export interface RoomCommand<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  commandId: string;
  roomId: string;
  handId: string | null;
  turnId: string | null;
  expectedVersion: number;
  type: RoomCommandType;
  payload: TPayload;
}

export interface CommandAck {
  status: 'accepted' | 'rejected';
  commandId: string;
  appliedVersion: number;
  errorCode?: string;
  message?: string;
  snapshot?: GameSnapshot;
}

export interface RoomEvent {
  version: number;
  type: string;
  snapshot?: GameSnapshot;
}

export interface SocketTicket {
  ticket: string;
  expiresAt?: string;
}

const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
const snapshotBoundarySchema = {
  type: 'object',
  required: ['roomId', 'roomCode', 'version', 'phase', 'players'],
  properties: {
    roomId: { type: 'string', minLength: 1 },
    roomCode: { type: 'string', minLength: 1 },
    version: { type: 'integer', minimum: 0 },
    phase: { type: 'string' },
    players: { type: 'array' },
  },
  additionalProperties: true,
} as const;
const validateSnapshotBoundary = ajv.compile(snapshotBoundarySchema);

const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};

const first = (source: Record<string, unknown>, keys: string[]): unknown => {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) return source[key];
  }
  return undefined;
};

const textValue = (source: Record<string, unknown>, keys: string[], fallback = ''): string => {
  const value = first(source, keys);
  return typeof value === 'string' ? value : fallback;
};

const numberValue = (source: Record<string, unknown>, keys: string[], fallback = 0): number => {
  const value = first(source, keys);
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback;
};

const boolValue = (source: Record<string, unknown>, keys: string[], fallback = false): boolean => {
  const value = first(source, keys);
  return typeof value === 'boolean' ? value : fallback;
};

const listValue = (source: Record<string, unknown>, keys: string[]): unknown[] => {
  const value = first(source, keys);
  return Array.isArray(value) ? value : [];
};

const phaseAliases: Record<string, RoomPhase> = {
  lobby: 'lobby',
  waiting: 'lobby',
  collecting_entropy: 'collecting_entropy',
  collecting_randomness: 'collecting_entropy',
  shuffling: 'collecting_entropy',
  playing: 'playing',
  in_hand: 'playing',
  settlement: 'settlement',
  showdown: 'settlement',
  paused: 'paused',
  closed: 'closed',
};

const playerStatusAliases: Record<string, PlayerStatus> = {
  waiting: 'waiting',
  active: 'active',
  folded: 'folded',
  all_in: 'all_in',
  allin: 'all_in',
  sitting_out: 'sitting_out',
  sit_out: 'sitting_out',
  eliminated: 'eliminated',
};

const normalizeConfig = (value: unknown): RoomConfig => {
  const source = record(value);
  const timeout = numberValue(source, ['actionTimeoutSeconds', 'action_timeout_seconds', 'actionTimeout'], 30);
  return {
    maxPlayers: numberValue(source, ['maxPlayers', 'max_players'], 8),
    smallBlind: numberValue(source, ['smallBlind', 'small_blind'], 10),
    bigBlind: numberValue(source, ['bigBlind', 'big_blind'], 20),
    initialStack: numberValue(source, ['initialStack', 'initial_stack', 'buyIn'], 2000),
    actionTimeoutSeconds: timeout === 15 || timeout === 60 ? timeout : 30,
  };
};

const normalizePlayer = (value: unknown): PlayerState => {
  const source = record(value);
  const rawStatus = textValue(source, ['status'], 'waiting').toLowerCase();
  return {
    memberId: textValue(source, ['memberId', 'member_id', 'playerId', 'id']),
    nickname: textValue(source, ['nickname', 'name'], '玩家'),
    seat: numberValue(source, ['seat', 'seatIndex', 'seat_index']),
    stack: numberValue(source, ['stack', 'chips']),
    borrowedTotal: numberValue(source, ['borrowedTotal', 'borrowed_total']),
    rankingScore: numberValue(
      source,
      ['rankingScore', 'ranking_score'],
      numberValue(source, ['stack', 'chips']) - numberValue(source, ['borrowedTotal', 'borrowed_total']),
    ),
    streetBet: numberValue(source, ['streetBet', 'street_bet', 'bet']),
    committed: numberValue(source, ['committed', 'totalCommitted', 'total_committed']),
    status: playerStatusAliases[rawStatus] ?? 'waiting',
    ready: boolValue(source, ['ready', 'isReady', 'is_ready']),
    online: boolValue(source, ['online', 'connected', 'isOnline', 'is_online'], true),
    isHost: boolValue(source, ['isHost', 'is_host', 'host']),
    rebuyPending: boolValue(source, ['rebuyPending', 'rebuy_pending']),
    holeCards: normalizeCards(first(source, ['holeCards', 'hole_cards'])),
    lastAction: textValue(source, ['lastAction', 'last_action']) || undefined,
  };
};

const normalizeLegalActions = (value: unknown): LegalActions => {
  const source = record(value);
  const allowed = new Set(listValue(source, ['allowed', 'actions']).filter((item): item is string => typeof item === 'string'));
  return {
    canFold: boolValue(source, ['canFold', 'can_fold'], allowed.has('fold')),
    canCheck: boolValue(source, ['canCheck', 'can_check'], allowed.has('check')),
    canCall: boolValue(source, ['canCall', 'can_call'], allowed.has('call')),
    canRaise: boolValue(source, ['canRaise', 'can_raise'], allowed.has('raise_to') || allowed.has('raise')),
    canAllIn: boolValue(source, ['canAllIn', 'can_all_in'], allowed.has('all_in')),
    callAmount: numberValue(source, ['callAmount', 'call_amount']),
    minRaiseTo: numberValue(source, ['minRaiseTo', 'min_raise_to']),
    maxRaiseTo: numberValue(source, ['maxRaiseTo', 'max_raise_to']),
  };
};

const normalizeCards = (value: unknown): CardCode[] =>
  (Array.isArray(value) ? value : [])
    .map((card) => typeof card === 'string' ? card : textValue(record(card), ['code']))
    .filter((card): card is string => /^[2-9TJQKA][cdhs]$/i.test(card))
    .map((card) => `${card[0]?.toUpperCase()}${card[1]?.toLowerCase()}` as CardCode);

const normalizeCompletedHands = (value: unknown): CompletedHand[] => listValue(record(value), ['completedHands', 'completed_hands'])
  .map((entry) => {
    const source = record(entry);
    return {
      handId: textValue(source, ['handId', 'hand_id']),
      handNumber: numberValue(source, ['handNumber', 'hand_number']),
      completedAt: textValue(source, ['completedAt', 'completed_at']),
      board: normalizeCards(first(source, ['board'])),
      pot: numberValue(source, ['pot']),
      players: listValue(source, ['players']).map((item) => {
        const player = record(item);
        return {
          memberId: textValue(player, ['memberId', 'member_id']),
          nickname: textValue(player, ['nickname', 'name'], '玩家'),
          seat: numberValue(player, ['seat']),
          holeCards: normalizeCards(first(player, ['holeCards', 'hole_cards'])),
          handName: textValue(player, ['handName', 'hand_name'], '未摊牌'),
          delta: numberValue(player, ['delta']),
          folded: boolValue(player, ['folded']),
        };
      }),
    };
  })
  .filter((hand) => Boolean(hand.handId) && hand.handNumber > 0);

const normalizeRoomLogs = (value: unknown): RoomLogEntry[] => listValue(record(value), ['roomLogs', 'room_logs'])
  .map((entry) => {
    const source = record(entry);
    return {
      id: textValue(source, ['id']),
      type: textValue(source, ['type'], 'system'),
      message: textValue(source, ['message']),
      createdAt: textValue(source, ['createdAt', 'created_at']),
      handId: textValue(source, ['handId', 'hand_id']) || undefined,
    };
  })
  .filter((entry) => Boolean(entry.id) && Boolean(entry.message));

export const normalizeSnapshot = (value: unknown): GameSnapshot => {
  const outer = record(value);
  const source = record(first(outer, ['snapshot', 'data']) ?? outer);
  const handSource = record(first(source, ['hand']));
  const youSource = record(first(source, ['you']));
  const normalizedBoundary = {
    roomId: textValue(source, ['roomId', 'room_id']),
    roomCode: textValue(source, ['roomCode', 'room_code', 'code']).toUpperCase(),
    version: numberValue(source, ['version']),
    phase: textValue(source, ['phase', 'state'], 'lobby').toLowerCase(),
    players: listValue(source, ['players', 'members']),
  };
  if (!validateSnapshotBoundary(normalizedBoundary)) {
    throw new Error(`无效的房间快照：${ajv.errorsText(validateSnapshotBoundary.errors)}`);
  }

  const fairnessSource = record(first(source, ['fairness', 'shuffle']));
  const settlementSource = record(first(handSource, ['settlement']) ?? first(source, ['settlement', 'result']));
  const winnerValues = listValue(settlementSource, ['awards', 'winners']);
  const deadline = textValue(handSource, ['deadlineAt', 'deadline_at'], textValue(source, ['deadlineAt', 'deadline_at']));
  const phase = phaseAliases[normalizedBoundary.phase] ?? 'lobby';
  const normalizedPlayers = normalizedBoundary.players.map(normalizePlayer);
  const heroMemberId = textValue(youSource, ['memberId', 'member_id'], textValue(source, ['heroMemberId', 'hero_member_id', 'memberId', 'member_id']));
  const actorMemberId = textValue(handSource, ['actorMemberId', 'actor_member_id']);
  const heroPlayerSource = record(normalizedBoundary.players.find((value) => {
    const player = record(value);
    return textValue(player, ['memberId', 'member_id', 'playerId', 'id']) === heroMemberId;
  }));
  const explicitActorSeat = numberValue(handSource, ['actorSeat', 'actor_seat'], -1);
  const derivedActorSeat = normalizedPlayers.find((player) => player.memberId === actorMemberId)?.seat ?? -1;

  return {
    roomId: normalizedBoundary.roomId,
    roomCode: normalizedBoundary.roomCode,
    version: normalizedBoundary.version,
    handId: textValue(handSource, ['handId', 'hand_id'], textValue(source, ['handId', 'hand_id'])) || null,
    turnId: textValue(handSource, ['turnId', 'turn_id'], textValue(source, ['turnId', 'turn_id'])) || null,
    phase,
    config: normalizeConfig(first(source, ['config', 'roomConfig', 'room_config'])),
    players: normalizedPlayers,
    buttonSeat: first(handSource, ['buttonSeat', 'button_seat']) === null
      ? null
      : numberValue(handSource, ['buttonSeat', 'button_seat'], numberValue(source, ['buttonSeat', 'button_seat', 'dealerSeat'], -1)) >= 0
        ? numberValue(handSource, ['buttonSeat', 'button_seat'], numberValue(source, ['buttonSeat', 'button_seat', 'dealerSeat']))
        : null,
    actingSeat: explicitActorSeat >= 0
      ? explicitActorSeat
      : derivedActorSeat >= 0
        ? derivedActorSeat
        : numberValue(source, ['actingSeat', 'acting_seat', 'currentSeat'], -1) >= 0
          ? numberValue(source, ['actingSeat', 'acting_seat', 'currentSeat'])
          : null,
    communityCards: normalizeCards(first(handSource, ['board']) ?? first(source, ['communityCards', 'community_cards', 'board'])),
    holeCards: normalizeCards(first(heroPlayerSource, ['holeCards', 'hole_cards']) ?? first(source, ['holeCards', 'hole_cards', 'privateCards', 'private_cards'])),
    pots: (listValue(handSource, ['pots']).length > 0 ? listValue(handSource, ['pots']) : listValue(source, ['pots'])).map((item) => {
      const pot = record(item);
      return {
        amount: numberValue(pot, ['amount', 'chips']),
        eligibleMemberIds: listValue(pot, ['eligibleMemberIds', 'eligible_member_ids'])
          .filter((id): id is string => typeof id === 'string'),
      };
    }),
    currentBet: numberValue(handSource, ['currentBet', 'current_bet'], numberValue(source, ['currentBet', 'current_bet'])),
    legalActions: normalizeLegalActions(first(handSource, ['legalActions', 'legal_actions']) ?? first(source, ['legalActions', 'legal_actions'])),
    deadlineAt: deadline || null,
    serverNow: textValue(source, ['serverNow', 'server_now'], new Date().toISOString()),
    heroMemberId,
    lateJoin: normalizedPlayers.find((player) => player.memberId === heroMemberId)?.status === 'sitting_out'
      || (
        phase === 'playing'
        && normalizedPlayers.find((player) => player.memberId === heroMemberId)?.status === 'waiting'
      )
      || boolValue(source, ['lateJoin', 'late_join', 'waitingForNextHand']),
    paused: phase === 'paused' || boolValue(source, ['paused']),
    closePending: boolValue(source, ['closePending', 'close_pending']),
    settlement: winnerValues.length > 0
      ? {
          winners: winnerValues.map((value) => {
            const winner = record(value);
            return {
              memberId: textValue(winner, ['memberId', 'member_id', 'playerId']),
              nickname: textValue(
                winner,
                ['nickname', 'name'],
                normalizedPlayers.find((player) => player.memberId === textValue(winner, ['memberId', 'member_id', 'playerId']))?.nickname ?? '玩家',
              ),
              amount: numberValue(winner, ['amount', 'won']),
              handName: textValue(winner, ['handName', 'hand_name']) || undefined,
            };
          }),
          reason: textValue(settlementSource, ['reason']) || undefined,
        }
      : undefined,
    roomLogs: normalizeRoomLogs(source),
    completedHands: normalizeCompletedHands(source),
    fairness: {
      serverCommitment: textValue(fairnessSource, ['serverCommitment', 'server_commitment', 'commitment']) || undefined,
      merkleRoot: textValue(fairnessSource, ['merkleRoot', 'merkle_root']) || undefined,
      contributionsReceived: numberValue(fairnessSource, ['contributionsReceived', 'contributions_received']),
      contributionsRequired: numberValue(fairnessSource, ['contributionsRequired', 'contributions_required']),
      contributionRequired: boolValue(fairnessSource, ['contributionRequired', 'contribution_required']),
      auditAvailable: boolValue(fairnessSource, ['auditAvailable', 'audit_available']),
    },
  };
};

export const normalizeRoomSession = (value: unknown, nickname: string): RoomSession => {
  const outer = record(value);
  const source = record(first(outer, ['data', 'room']) ?? outer);
  const session = {
    roomId: textValue(source, ['roomId', 'room_id', 'id']),
    roomCode: textValue(source, ['roomCode', 'room_code', 'code']).toUpperCase(),
    memberId: textValue(source, ['memberId', 'member_id', 'playerId', 'player_id']),
    nickname,
  };
  if (!session.roomId || !session.roomCode || !session.memberId) {
    throw new Error('服务器返回的房间凭据不完整');
  }
  return session;
};

export const normalizeSocketTicket = (value: unknown): SocketTicket => {
  const outer = record(value);
  const source = record(first(outer, ['data']) ?? outer);
  const ticket = textValue(source, ['ticket', 'socketTicket', 'socket_ticket']);
  if (!ticket) throw new Error('服务器未返回实时连接票据');
  return { ticket, expiresAt: textValue(source, ['expiresAt', 'expires_at']) || undefined };
};

export const normalizeAck = (value: unknown, commandId: string): CommandAck => {
  const outer = record(value);
  const source = record(first(outer, ['data', 'ack']) ?? outer);
  const rawStatus = textValue(source, ['status'], boolValue(source, ['accepted']) ? 'accepted' : 'rejected');
  const snapshotValue = first(source, ['snapshot']);
  return {
    status: rawStatus === 'accepted' ? 'accepted' : 'rejected',
    commandId: textValue(source, ['commandId', 'command_id'], commandId),
    appliedVersion: numberValue(source, ['appliedVersion', 'applied_version', 'version']),
    errorCode: textValue(source, ['errorCode', 'error_code']) || undefined,
    message: textValue(source, ['message', 'detail']) || undefined,
    snapshot: snapshotValue ? normalizeSnapshot(snapshotValue) : undefined,
  };
};

export const normalizeRoomEvent = (value: unknown): RoomEvent => {
  const source = record(value);
  const snapshotValue = first(source, ['snapshot']);
  return {
    version: numberValue(source, ['version', 'appliedVersion', 'applied_version']),
    type: textValue(source, ['type', 'eventType', 'event_type'], 'room_changed'),
    snapshot: snapshotValue ? normalizeSnapshot(snapshotValue) : undefined,
  };
};

export const makeCommand = (
  snapshot: GameSnapshot,
  type: RoomCommandType,
  payload: Record<string, unknown> = {},
): RoomCommand => ({
  commandId: crypto.randomUUID(),
  roomId: snapshot.roomId,
  handId: snapshot.handId,
  turnId: snapshot.turnId,
  expectedVersion: snapshot.version,
  type,
  payload,
});

export const DEFAULT_ROOM_CONFIG: RoomConfig = {
  maxPlayers: 8,
  smallBlind: 10,
  bigBlind: 20,
  initialStack: 2000,
  actionTimeoutSeconds: 30,
};
