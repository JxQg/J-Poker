export const bytesToBase64Url = (value: Uint8Array): string => {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export const base64UrlToBytes = (value: string, expectedLength?: number): Uint8Array => {
  const unpadded = value.replace(/=+$/, '');
  if (!/^[A-Za-z0-9_-]*$/.test(unpadded)) throw new Error('数据不是 URL-safe base64');
  const normalized = unpadded.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new Error('数据不是 URL-safe base64');
  }
  const decoded = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (expectedLength !== undefined && decoded.length !== expectedLength) {
    throw new Error(`数据长度必须为 ${expectedLength} 字节`);
  }
  if (bytesToBase64Url(decoded) !== unpadded) throw new Error('base64url 编码不是规范格式');
  return decoded;
};
