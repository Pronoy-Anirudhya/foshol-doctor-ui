/**
 * WEB-DATA-005 — one Idempotency-Key (UUID) per submission attempt, reused for every retry of
 * that same attempt. A new key is generated only when the draft content changes; the server
 * returns 409 for the same key with a different body.
 */
export function newUuid(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();

  // Secure-context fallback. getRandomValues is available wherever this app is supported.
  const bytes = new Uint8Array(16);
  c.getRandomValues(bytes);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant 10
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
