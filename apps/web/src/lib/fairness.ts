import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import { shake256 } from '@noble/hashes/sha3';
import { base64UrlToBytes, bytesToBase64Url } from './fairnessEncoding';

export { base64UrlToBytes, bytesToBase64Url } from './fairnessEncoding';

const encoder = new TextEncoder();
const SERVER_SEED_DOMAIN = encoder.encode('holdem-server-seed-v1\0');
const SHUFFLE_STREAM_DOMAIN = encoder.encode('holdem-shuffle-stream-v1\0');
const MERKLE_LEAF_DOMAIN = encoder.encode('holdem-merkle-leaf-v1\0');
const MERKLE_NODE_DOMAIN = encoder.encode('holdem-merkle-node-v1\0');
const MERKLE_SALT_DOMAIN = encoder.encode('holdem-merkle-salt-v1\0');
const SHUFFLE_VERSION = 'shake256-fisher-yates-v1';

export const STANDARD_DECK = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A']
  .flatMap((rank) => ['c', 'd', 'h', 's'].map((suit) => `${rank}${suit}`));

export interface AuditContribution {
  seat: number;
  entropy: string;
}

export interface AuditEvent {
  version: number;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
  previousHash: string;
  hash: string;
}

export interface AuditHand {
  handId: string;
  handNumber: number;
  serverSeed: string;
  serverCommitment: string;
  contributions: Record<string, AuditContribution>;
  deck: string[];
  leafSalts: string[];
  merkleRoot: string;
}

export interface AuditPackage {
  schemaVersion: '1.0';
  rulesVersion: 'pokerkit-0.7.5/nlhe-v1';
  roomId: string;
  roomCode: string;
  closedAt: string;
  finalEventHash: string;
  events: AuditEvent[];
  hands: AuditHand[];
  signatureAlgorithm: 'Ed25519';
  signingPublicKey: string;
  signature: string;
}

export interface AuditCheck {
  label: string;
  passed: boolean;
  detail: string;
}

export interface AuditVerificationResult {
  valid: boolean;
  checks: AuditCheck[];
}

export interface DeckMaterial {
  deckKey: Uint8Array;
  deck: string[];
  leafSalts: Uint8Array[];
  merkleRoot: string;
  proofs: string[][];
}

const concatBytes = (...values: Uint8Array[]): Uint8Array => {
  const output = new Uint8Array(values.reduce((length, value) => length + value.length, 0));
  let offset = 0;
  for (const value of values) {
    output.set(value, offset);
    offset += value.length;
  }
  return output;
};

const uint16be = (value: number): Uint8Array => new Uint8Array([(value >>> 8) & 0xff, value & 0xff]);

const bytesToHex = (value: Uint8Array): string =>
  Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');

const hexToBytes = (value: string, expectedLength?: number): Uint8Array => {
  if (!/^[0-9a-f]+$/i.test(value) || value.length % 2 !== 0) throw new Error('事件哈希格式无效');
  const output = Uint8Array.from({ length: value.length / 2 }, (_, index) =>
    Number.parseInt(value.slice(index * 2, index * 2 + 2), 16));
  if (expectedLength !== undefined && output.length !== expectedLength) throw new Error('事件哈希长度无效');
  return output;
};

const quoteAscii = (value: string): string => JSON.stringify(value).replace(/[\u007f-\uffff]/g, (character) => {
  const point = character.codePointAt(0) ?? 0;
  return `\\u${point.toString(16).padStart(4, '0')}`;
});

export const canonicalJson = (value: unknown): string => {
  if (value === null) return 'null';
  if (typeof value === 'string') return quoteAscii(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const source = value as Record<string, unknown>;
    return `{${Object.keys(source)
      .filter((key) => source[key] !== undefined)
      .sort()
      .map((key) => `${quoteAscii(key)}:${canonicalJson(source[key])}`)
      .join(',')}}`;
  }
  throw new Error('审计材料包含不能规范编码的数据');
};

const canonicalBytes = (value: unknown): Uint8Array => encoder.encode(canonicalJson(value));
const eventHashTimestamp = (value: string): string =>
  value.endsWith('Z') ? `${value.slice(0, -1)}+00:00` : value;

export const serverSeedCommitment = (serverSeed: Uint8Array, roomId: string, handId: string): string =>
  bytesToBase64Url(sha256(concatBytes(
    SERVER_SEED_DOMAIN,
    encoder.encode(roomId),
    new Uint8Array([0]),
    encoder.encode(handId),
    new Uint8Array([0]),
    serverSeed,
  )));

export const deriveDeckKey = (
  serverSeed: Uint8Array,
  contributions: Array<{ seat: number; memberId: string; entropy: Uint8Array }>,
  roomId: string,
  handId: string,
  rulesVersion: string,
): Uint8Array => {
  const ordered = [...contributions].sort((left, right) => {
    if (left.seat !== right.seat) return left.seat - right.seat;
    return left.memberId < right.memberId ? -1 : left.memberId > right.memberId ? 1 : 0;
  });
  const inputKeyMaterial = concatBytes(serverSeed, ...ordered.map(({ entropy }) => entropy));
  const context = canonicalBytes({
    handId,
    members: ordered.map(({ memberId, seat }) => ({ memberId, seat })),
    roomId,
    rulesVersion,
    shuffleVersion: SHUFFLE_VERSION,
  });
  return hkdf(
    sha256,
    inputKeyMaterial,
    sha256(encoder.encode('holdem-deck-key-v1')),
    context,
    32,
  );
};

class ShakeReader {
  private offset = 0;
  private output = new Uint8Array();
  private readonly input: Uint8Array;

  constructor(key: Uint8Array) {
    this.input = concatBytes(SHUFFLE_STREAM_DOMAIN, key);
  }

  private readByte(): number {
    if (this.offset >= this.output.length) {
      const length = Math.max(128, this.output.length * 2);
      this.output = shake256(this.input, { dkLen: length });
    }
    const value = this.output[this.offset];
    this.offset += 1;
    if (value === undefined) throw new Error('SHAKE256 随机流读取失败');
    return value;
  }

  randbelow(bound: number): number {
    if (!Number.isInteger(bound) || bound < 1 || bound > 256) throw new Error('随机范围必须在 1-256 之间');
    const limit = 256 - (256 % bound);
    while (true) {
      const value = this.readByte();
      if (value < limit) return value % bound;
    }
  }
}

export const shuffledDeck = (deckKey: Uint8Array): string[] => {
  const deck = [...STANDARD_DECK];
  const random = new ShakeReader(deckKey);
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const target = random.randbelow(index + 1);
    const held = deck[index];
    deck[index] = deck[target] ?? '';
    deck[target] = held ?? '';
  }
  return deck;
};

const leafHash = (index: number, card: string, salt: Uint8Array): Uint8Array =>
  sha256(concatBytes(MERKLE_LEAF_DOMAIN, uint16be(index), encoder.encode(card), new Uint8Array([0]), salt));

const nodeHash = (left: Uint8Array, right: Uint8Array): Uint8Array =>
  sha256(concatBytes(MERKLE_NODE_DOMAIN, left, right));

export const deriveLeafSalts = (deckKey: Uint8Array): Uint8Array[] =>
  Array.from({ length: 52 }, (_, index) => hkdf(
    sha256,
    deckKey,
    new Uint8Array(32),
    concatBytes(MERKLE_SALT_DOMAIN, uint16be(index)),
    16,
  ));

export const buildMerkleTree = (
  deck: string[],
  leafSalts: Uint8Array[],
): { merkleRoot: string; proofs: string[][] } => {
  if (deck.length !== 52 || leafSalts.length !== deck.length) {
    throw new Error('Merkle 树需要标准 52 张牌及逐牌盐值');
  }
  const levels: Uint8Array[][] = [deck.map((card, index) => leafHash(index, card, leafSalts[index] ?? new Uint8Array()))];
  while ((levels.at(-1)?.length ?? 0) > 1) {
    const current = levels.at(-1) ?? [];
    const next: Uint8Array[] = [];
    for (let index = 0; index < current.length; index += 2) {
      const left = current[index];
      const right = current[index + 1] ?? left;
      if (!left || !right) throw new Error('Merkle 树节点缺失');
      next.push(nodeHash(left, right));
    }
    levels.push(next);
  }

  const proofs = deck.map((_, deckIndex) => {
    const proof: string[] = [];
    let position = deckIndex;
    for (const level of levels.slice(0, -1)) {
      if (position % 2 === 1) {
        const sibling = level[position - 1];
        if (!sibling) throw new Error('Merkle 左侧证明缺失');
        proof.push(`L:${bytesToBase64Url(sibling)}`);
      } else {
        const sibling = level[position + 1] ?? level[position];
        if (!sibling) throw new Error('Merkle 右侧证明缺失');
        proof.push(`R:${bytesToBase64Url(sibling)}`);
      }
      position = Math.floor(position / 2);
    }
    return proof;
  });
  const root = levels.at(-1)?.[0];
  if (!root) throw new Error('Merkle 根节点缺失');
  return { merkleRoot: bytesToBase64Url(root), proofs };
};

export const verifyMerkleProof = (
  card: string,
  deckIndex: number,
  salt: Uint8Array,
  proof: string[],
  expectedRoot: string,
): boolean => {
  let value = leafHash(deckIndex, card, salt);
  for (const step of proof) {
    const separator = step.indexOf(':');
    if (separator < 0) return false;
    const side = step.slice(0, separator);
    const sibling = base64UrlToBytes(step.slice(separator + 1), 32);
    if (side === 'L') value = nodeHash(sibling, value);
    else if (side === 'R') value = nodeHash(value, sibling);
    else return false;
  }
  return bytesToBase64Url(value) === expectedRoot;
};

export const createDeckMaterial = (
  serverSeed: Uint8Array,
  contributions: Array<{ seat: number; memberId: string; entropy: Uint8Array }>,
  roomId: string,
  handId: string,
  rulesVersion: string,
): DeckMaterial => {
  const deckKey = deriveDeckKey(serverSeed, contributions, roomId, handId, rulesVersion);
  const deck = shuffledDeck(deckKey);
  const leafSalts = deriveLeafSalts(deckKey);
  const { merkleRoot, proofs } = buildMerkleTree(deck, leafSalts);
  return { deckKey, deck, leafSalts, merkleRoot, proofs };
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseAuditPackage = (value: unknown): AuditPackage => {
  if (!isObject(value)) throw new Error('审计包必须是 JSON 对象');
  const requiredStrings = [
    'schemaVersion', 'rulesVersion', 'roomId', 'roomCode', 'closedAt', 'finalEventHash',
    'signatureAlgorithm', 'signingPublicKey', 'signature',
  ];
  if (requiredStrings.some((key) => typeof value[key] !== 'string')) throw new Error('审计包缺少必要字段');
  if (!Array.isArray(value.events) || !Array.isArray(value.hands)) throw new Error('审计包事件或手牌材料无效');
  return value as unknown as AuditPackage;
};

const verifyHand = (audit: AuditPackage, hand: AuditHand): AuditCheck[] => {
  const label = `第 ${hand.handNumber} 手`;
  try {
    const serverSeed = base64UrlToBytes(hand.serverSeed, 32);
    const commitmentMatches = serverSeedCommitment(serverSeed, audit.roomId, hand.handId) === hand.serverCommitment;
    const contributions = Object.entries(hand.contributions).map(([memberId, contribution]) => ({
      memberId,
      seat: contribution.seat,
      entropy: base64UrlToBytes(contribution.entropy, 32),
    }));
    const material = createDeckMaterial(serverSeed, contributions, audit.roomId, hand.handId, audit.rulesVersion);
    const deckMatches = material.deck.length === hand.deck.length
      && material.deck.every((card, index) => card === hand.deck[index]);
    const saltsMatch = material.leafSalts.length === hand.leafSalts.length
      && material.leafSalts.every((salt, index) => bytesToBase64Url(salt) === hand.leafSalts[index]);
    const rootMatches = material.merkleRoot === hand.merkleRoot;
    return [
      { label: `${label} 服务端承诺`, passed: commitmentMatches, detail: commitmentMatches ? '上下文承诺一致' : '上下文承诺不一致' },
      { label: `${label} 确定性洗牌`, passed: deckMatches, detail: deckMatches ? '52 张牌顺序一致' : '复原牌序不一致' },
      { label: `${label} 逐牌盐值`, passed: saltsMatch, detail: saltsMatch ? '52 个盐值一致' : '逐牌盐值不一致' },
      { label: `${label} 牌组承诺`, passed: rootMatches, detail: rootMatches ? 'Merkle Root 一致' : 'Merkle Root 不一致' },
    ];
  } catch (error) {
    return [{ label, passed: false, detail: error instanceof Error ? error.message : '手牌材料无效' }];
  }
};

export const auditEventHash = (roomId: string, event: Omit<AuditEvent, 'previousHash' | 'hash'>, previousHash: string): string => {
  const envelope = {
    roomId,
    version: event.version,
    type: event.type,
    payload: event.payload,
    createdAt: eventHashTimestamp(event.createdAt),
  };
  return bytesToHex(sha256(concatBytes(
    hexToBytes(previousHash, 32),
    canonicalBytes(envelope),
  )));
};

const verifyEventLinks = (audit: AuditPackage): boolean => {
  let expectedPrevious = '0'.repeat(64);
  for (const event of audit.events) {
    if (event.previousHash !== expectedPrevious) return false;
    const calculated = auditEventHash(audit.roomId, {
      version: event.version,
      type: event.type,
      payload: event.payload,
      createdAt: event.createdAt,
    }, expectedPrevious);
    if (calculated !== event.hash) return false;
    expectedPrevious = event.hash;
  }
  return audit.finalEventHash === expectedPrevious;
};

const verifyAuditSignature = async (audit: AuditPackage): Promise<boolean> => {
  try {
    const { signature, ...signedPayload } = audit;
    const publicKey = await crypto.subtle.importKey(
      'raw',
      base64UrlToBytes(audit.signingPublicKey, 32),
      { name: 'Ed25519' },
      false,
      ['verify'],
    );
    return crypto.subtle.verify(
      { name: 'Ed25519' },
      publicKey,
      base64UrlToBytes(signature, 64),
      canonicalBytes(signedPayload),
    );
  } catch {
    return false;
  }
};

export const verifyAuditPackage = async (value: unknown): Promise<AuditVerificationResult> => {
  const audit = parseAuditPackage(value);
  if (audit.schemaVersion !== '1.0' || audit.signatureAlgorithm !== 'Ed25519') {
    throw new Error('审计包版本或签名算法不受支持');
  }
  const checks = audit.hands.flatMap((hand) => verifyHand(audit, hand));
  const linksMatch = verifyEventLinks(audit);
  checks.push({
    label: '事件链',
    passed: linksMatch,
    detail: linksMatch ? `${audit.events.length} 条事件内容与哈希链一致` : '事件内容、链连接或最终哈希不一致',
  });
  const signatureMatches = await verifyAuditSignature(audit);
  checks.push({
    label: '服务器签名',
    passed: signatureMatches,
    detail: signatureMatches ? 'Ed25519 签名有效' : 'Ed25519 签名无效',
  });
  return { valid: checks.length > 0 && checks.every((check) => check.passed), checks };
};
