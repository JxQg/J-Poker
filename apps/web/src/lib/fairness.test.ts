import { describe, expect, it } from 'vitest';
import shuffleVector from '../../../../contracts/shuffle-v1-vectors.json';
import {
  auditEventHash,
  base64UrlToBytes,
  bytesToBase64Url,
  createDeckMaterial,
  serverSeedCommitment,
  verifyMerkleProof,
} from './fairness';

describe('verifiable shuffle', () => {
  it('matches the shared Python fairness fixed vector', () => {
    const serverSeed = base64UrlToBytes(shuffleVector.serverSeed, 32);
    const material = createDeckMaterial(
      serverSeed,
      shuffleVector.contributions.map((contribution) => ({
        ...contribution,
        entropy: base64UrlToBytes(contribution.entropy, 32),
      })),
      shuffleVector.roomId,
      shuffleVector.handId,
      shuffleVector.rulesVersion,
    );

    expect(serverSeedCommitment(serverSeed, shuffleVector.roomId, shuffleVector.handId))
      .toBe(shuffleVector.serverCommitment);
    expect(bytesToBase64Url(material.deckKey)).toBe(shuffleVector.deckKey);
    expect(material.deck).toEqual(shuffleVector.deck);
    expect(material.leafSalts.map(bytesToBase64Url)).toEqual(shuffleVector.leafSalts);
    expect(material.merkleRoot).toBe(shuffleVector.merkleRoot);
    expect(material.proofs[0]).toEqual(shuffleVector.proofIndex0);
    expect(verifyMerkleProof(
      material.deck[0] ?? '',
      0,
      material.leafSalts[0] ?? new Uint8Array(),
      material.proofs[0] ?? [],
      material.merkleRoot,
    )).toBe(true);
  });

  it('enforces canonical base64url and contribution length', () => {
    expect(bytesToBase64Url(base64UrlToBytes('AAECAw'))).toBe('AAECAw');
    expect(() => base64UrlToBytes('AB')).toThrow('规范格式');
    expect(() => base64UrlToBytes('AAECAw', 32)).toThrow('32 字节');
  });

  it('binds every event payload into the audit hash chain', () => {
    const previousHash = '0'.repeat(64);
    const event = {
      version: 1,
      type: 'RoomCreated',
      payload: { stack: 2000, nested: { ready: true } },
      createdAt: '2026-08-27T06:00:00+00:00',
    };
    const hash = auditEventHash('room-1', event, previousHash);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(auditEventHash(
      'room-1',
      { ...event, createdAt: '2026-08-27T06:00:00Z' },
      previousHash,
    )).toBe(hash);
    expect(auditEventHash('room-1', { ...event, payload: { ...event.payload, stack: 1999 } }, previousHash))
      .not.toBe(hash);
  });
});
