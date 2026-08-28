import { bytesToBase64Url } from './fairnessEncoding';

export const createShuffleContribution = (): string => {
  const contribution = new Uint8Array(32);
  crypto.getRandomValues(contribution);
  return bytesToBase64Url(contribution);
};
