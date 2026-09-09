/**
 * Contract error codes → the translation key that explains each one in this feature's own terms.
 *
 * `problem.ts` already maps a STATUS to friendly copy, which is the right default for most of
 * the application. Farmer provision is the case where the status alone is not enough: a `400`
 * here can mean four genuinely different things an officer must act on differently — a
 * malformed number, a district they may not write to, an unknown geo code, or a spent
 * idempotency key. So this map is consulted first and `ErrorPanel`'s status fallback stays as
 * the safety net for everything unlisted.
 *
 * `ERR_FARMER_PHONE_EXISTS` is the one entry with a deliberate omission in its copy: the server
 * knows which district already holds that number, and the UI must NOT repeat it
 * (`WEB-FR-312`). "Already registered" is the whole of what an officer is told.
 */
const KEYS: ReadonlyMap<string, string> = new Map([
  ['ERR_PHONE_INVALID', 'farmers.error.phoneInvalid'],
  ['ERR_DISTRICT_SCOPE', 'farmers.error.districtScope'],
  ['ERR_GEO_INVALID', 'farmers.error.geoInvalid'],
  ['ERR_BAD_REQUEST', 'farmers.error.badRequest'],
  ['ERR_IDEMPOTENCY_KEY_MISSING', 'farmers.error.idempotencyMissing'],
  ['ERR_IDEMPOTENCY_KEY_INVALID', 'farmers.error.idempotencyInvalid'],
  ['ERR_IDEMPOTENCY_KEY_CONFLICT', 'farmers.error.idempotencyConflict'],
  ['ERR_FARMER_PHONE_EXISTS', 'farmers.error.phoneExists'],
  ['ERR_FARMER_NOT_FOUND', 'farmers.error.notFound'],
  ['ERR_FARMER_IMPORT_INVALID', 'farmers.error.importInvalid'],
  ['ERR_BULK_TOO_LARGE', 'farmers.error.bulkTooLarge'],
  ['ERR_BULK_DUPLICATE', 'farmers.error.bulkDuplicate'],
  ['ERR_FORBIDDEN', 'farmers.error.forbidden'],
  ['ERR_UNSUPPORTED_MEDIA_TYPE', 'farmers.error.unsupportedMediaType'],
]);

/** `null` when the code is unknown, so the caller falls back to the generic problem display. */
export function farmerErrorKey(code: string | null | undefined): string | null {
  return code === null || code === undefined ? null : (KEYS.get(code) ?? null);
}
