import type { ProblemView } from '../../core/errors/problem';

/**
 * The `errorCode`s the console names in its own words rather than collapsing into "something
 * went wrong".
 *
 * `toProblemView` already carries `code` off every RFC 9457 body, and `ErrorPanel` already
 * renders the server's `title`/`detail` when there is one. But a transfer and a bulk run both
 * fail for reasons the officer can *act* on — the target is not eligible, the case is already
 * decided, somebody else holds the claim — and "Conflict" does not tell them which. So exactly
 * these codes get a sentence of their own; every other code keeps the generic panel, which is
 * the honest answer for a failure this console has nothing specific to say about.
 *
 * The key is derived from the code rather than mapped to a chosen string, so a code listed here
 * and a key present in `officer.i18n.json` are the same fact, checked by `check-i18n`.
 */
const NAMED_CODES: ReadonlySet<string> = new Set([
  // Same-district transfer (`REVIEW-FR-096` / `REVIEW-FR-097`).
  'ERR_TRANSFER_TO_SELF', //        400 — the caller picked themselves
  'ERR_TRANSFER_TARGET_INVALID', // 404 — inactive, another district, or an ADMIN
  'ERR_TASK_TERMINAL', //           409 — the case is already decided
  'ERR_CLAIM_NOT_HELD', //          409 — the caller does not hold a live claim
  // Already surfaced on claim and approve; repeated here so the same words are used.
  'ERR_TASK_CLAIMED', //            409 — another officer reached it first
  'ERR_VERSION_CONFLICT', //        409 — optimistic lock
  // Bulk (`REVIEW-FR-098`).
  'ERR_BULK_DUPLICATE', //          the same task id appeared twice in one request
  'ERR_BULK_TOO_LARGE', //          400 — over `foshol.review.bulk.max-size`
]);

const KEY_PREFIX = 'officer.error.';

/** The translation key for a server error code, or `null` when the console has no words of
    its own for it and the caller should fall back to the generic problem panel. */
export function officerErrorKey(code: string | null | undefined): string | null {
  return code !== null && code !== undefined && NAMED_CODES.has(code)
    ? `${KEY_PREFIX}${code}`
    : null;
}

/** The same question asked of a whole problem document. */
export function officerProblemKey(problem: ProblemView | null | undefined): string | null {
  return officerErrorKey(problem?.code);
}
