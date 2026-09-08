import type { Principal } from '../../generated/models/principal';

export type Role = Principal['role'];

interface JwtClaims {
  readonly sub?: string;
  readonly role?: string;
  readonly iss?: string;
  readonly exp?: number;
  readonly iat?: number;
}

const ROLES: readonly string[] = ['FARMER', 'OFFICER', 'ADMIN'];

/**
 * A ~20-line base64url claim decode instead of a JWT library (WEB-NFR-007).
 *
 * This does NOT verify the signature and is not trying to: the server verifies on every
 * request (COMMON-SEC-012). The client reads `role` and `exp` only to decide what to render
 * and when to stop — never to make an authorisation decision, which is why WEB-FR-003 also
 * says the client simply avoids issuing a request the server would 403.
 */
export function decodeJwtClaims(token: string): JwtClaims | null {
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const json = atob(payload.replaceAll('-', '+').replaceAll('_', '/'));
    const bytes = Uint8Array.from(json, (ch) => ch.charCodeAt(0));
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return typeof parsed === 'object' && parsed !== null ? (parsed as JwtClaims) : null;
  } catch {
    return null;
  }
}

/** WEB-SEC-002 / handover §2 — the role comes from the token, never from the URL. */
export function roleFromToken(token: string): Role | null {
  const role = decodeJwtClaims(token)?.role;
  return typeof role === 'string' && ROLES.includes(role) ? (role as Role) : null;
}

export function expiryFromToken(token: string): Date | null {
  const exp = decodeJwtClaims(token)?.exp;
  return typeof exp === 'number' ? new Date(exp * 1000) : null;
}
