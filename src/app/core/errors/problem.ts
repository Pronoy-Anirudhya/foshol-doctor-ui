import { HttpErrorResponse } from '@angular/common/http';
import type { Problem } from '../../generated/models/problem';
import type { QualityGateProblem } from '../../generated/models/quality-gate-problem';

/**
 * The single view model every failure in the application is reduced to.
 *
 * WEB-FR-005 — a response carrying an RFC 9457 problem document (COMMON-API-002) is displayed
 * with its `title` and `detail`, and its `correlationId` in copyable form. The demo machine has
 * no log aggregator: the correlation id on screen is the only way a failure gets diagnosed in
 * the room, so it is a first-class field here rather than something a caller digs out.
 *
 * WEB-FR-404 — a raw stack, a raw browser network message or a raw response body NEVER reaches
 * the UI. When the server sent nothing useful, `titleKey`/`detailKey` name a friendly, human,
 * translated fallback instead.
 */

/**
 * HTTP status codes are protocol constants, not tunable configuration, so they live beside the
 * mapping that uses them rather than in APP_CONFIG (WEB-NFR-009 governs thresholds, limits,
 * intervals and sizes).
 */
export const HTTP_STATUS = {
  /** Angular reports a request that never completed an HTTP exchange as status 0. */
  networkFailure: 0,
  badRequest: 400,
  unauthorised: 401,
  forbidden: 403,
  notFound: 404,
  conflict: 409,
  payloadTooLarge: 413,
  unsupportedMediaType: 415,
  unprocessable: 422,
  tooManyRequests: 429,
  serviceUnavailable: 503,
} as const;

/** Exposed by the backend's CORS configuration (handover §1). */
export const CORRELATION_ID_HEADER = 'X-Correlation-Id';
export const RETRY_AFTER_HEADER = 'Retry-After';

const ERROR_KEY_PREFIX = 'errors.';
const GENERIC_KEY = 'generic';

/** Derived from the generated schema so the reason set can never drift from the contract. */
type RejectedImage = NonNullable<QualityGateProblem['rejectedImages']>[number];
export type RejectedImageReason = NonNullable<RejectedImage['reason']>;

export interface FieldErrorView {
  readonly field: string | null;
  readonly message: string | null;
}

export interface RejectedImageView {
  readonly position: number | null;
  readonly reason: RejectedImageReason | null;
  /** Server-supplied Bangla, rendered verbatim as text and never translated (WEB-UX-016). */
  readonly messageBn: string | null;
}

export interface ProblemView {
  /** 0 when the request never became an HTTP exchange (offline, DNS, CORS, aborted). */
  readonly status: number;
  /** A constant from `common.ErrorCodes`, when the server sent a problem document. */
  readonly code: string | null;
  readonly title: string | null;
  readonly detail: string | null;
  /** WEB-FR-005 — displayed in copyable form on every error surface. */
  readonly correlationId: string | null;
  readonly fieldErrors: readonly FieldErrorView[];
  /** Populated on a 422 quality-gate rejection; nothing was stored (handover §7.1). */
  readonly rejectedImages: readonly RejectedImageView[];
  /** From `Retry-After`, in seconds (WEB-FR-011). */
  readonly retryAfterSeconds: number | null;
  /**
   * WEB-FR-401 / WEB-FR-402 — the failure is worth offering a retry control for. The flag is
   * exposed and never acted on here: at most one automatic retry is allowed and only the
   * caller knows whether it has already spent it.
   */
  readonly retryable: boolean;
  /** Used when the server gave nothing useful. Always populated. */
  readonly titleKey: string;
  readonly detailKey: string;
}

/**
 * Status → friendly copy. Deliberately not exhaustive: anything unmapped is `generic`, because
 * a status code is never an acceptable headline for a farmer.
 */
const FALLBACK_KEYS = new Map<number, string>([
  [HTTP_STATUS.networkFailure, 'offline'],
  [HTTP_STATUS.badRequest, 'badRequest'],
  [HTTP_STATUS.unauthorised, 'unauthorised'],
  [HTTP_STATUS.forbidden, 'forbidden'],
  [HTTP_STATUS.notFound, 'notFound'],
  [HTTP_STATUS.conflict, 'conflict'],
  [HTTP_STATUS.payloadTooLarge, 'tooLarge'],
  [HTTP_STATUS.unsupportedMediaType, 'unsupportedType'],
  [HTTP_STATUS.unprocessable, 'quality'],
  [HTTP_STATUS.tooManyRequests, 'rateLimited'],
  [HTTP_STATUS.serviceUnavailable, 'unavailable'],
]);

const RETRYABLE = new Set<number>([HTTP_STATUS.networkFailure, HTTP_STATUS.serviceUnavailable]);

const str = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * An error body is only treated as a problem document when it carries RFC 9457's own fields.
 * Anything else — an HTML error page, a proxy message, a `ProgressEvent` — is discarded rather
 * than shown, which is how a raw browser string is kept off the screen.
 */
function problemBody(error: unknown): Record<string, unknown> | null {
  const candidate = record(typeof error === 'string' ? parseJson(error) : error);
  if (candidate === null) return null;
  const looksLikeProblem =
    str(candidate['title']) !== null ||
    str(candidate['code']) !== null ||
    str(candidate['type']) !== null ||
    str(candidate['correlationId']) !== null;
  return looksLikeProblem ? candidate : null;
}

function fieldErrorsOf(body: Record<string, unknown> | null): readonly FieldErrorView[] {
  const raw = body?.['errors'];
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry): FieldErrorView[] => {
    const item = record(entry);
    return item === null ? [] : [{ field: str(item['field']), message: str(item['message']) }];
  });
}

function rejectedImagesOf(body: Record<string, unknown> | null): readonly RejectedImageView[] {
  const raw = body?.['rejectedImages'];
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry): RejectedImageView[] => {
    const item = record(entry);
    if (item === null) return [];
    const reason = str(item['reason']);
    return [
      {
        position: num(item['position']),
        reason: reason === null ? null : (reason as RejectedImageReason),
        messageBn: str(item['messageBn']),
      },
    ];
  });
}

function retryAfterOf(err: HttpErrorResponse): number | null {
  const raw = err.headers?.get(RETRY_AFTER_HEADER);
  if (raw === null || raw === undefined) return null;
  const seconds = Number.parseInt(raw, 10);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

function fallbackKey(status: number): string {
  return FALLBACK_KEYS.get(status) ?? GENERIC_KEY;
}

function view(partial: Omit<ProblemView, 'titleKey' | 'detailKey'>, key: string): ProblemView {
  return {
    ...partial,
    titleKey: `${ERROR_KEY_PREFIX}${key}.title`,
    detailKey: `${ERROR_KEY_PREFIX}${key}.detail`,
  };
}

const EMPTY = {
  code: null,
  title: null,
  detail: null,
  correlationId: null,
  fieldErrors: [],
  rejectedImages: [],
  retryAfterSeconds: null,
} as const;

/**
 * Reduce anything thrown by the HTTP layer — a `Problem`, a `QualityGateProblem`, an opaque
 * body, a network failure, a programming error — to one displayable shape.
 */
export function toProblemView(err: unknown): ProblemView {
  if (!(err instanceof HttpErrorResponse)) {
    // Not an HTTP exchange at all, so there is no status and nothing of the underlying error
    // is safe to show. WEB-FR-404: the raw message is dropped, not rendered.
    return view(
      { ...EMPTY, status: HTTP_STATUS.networkFailure, retryable: false },
      GENERIC_KEY,
    );
  }

  const body = problemBody(err.error);
  const headerCorrelationId = err.headers?.get(CORRELATION_ID_HEADER) ?? null;
  const status = err.status;

  return view(
    {
      status,
      code: str(body?.['code']),
      title: str(body?.['title']),
      detail: str(body?.['detail']),
      correlationId: str(body?.['correlationId']) ?? str(headerCorrelationId),
      fieldErrors: fieldErrorsOf(body),
      rejectedImages: rejectedImagesOf(body),
      retryAfterSeconds: retryAfterOf(err),
      retryable: RETRYABLE.has(status),
    },
    fallbackKey(status),
  );
}

/** Narrowing helper for callers that want the typed contract shape rather than the view. */
export function isProblem(value: unknown): value is Problem {
  const body = problemBody(value);
  return body !== null && typeof body['status'] === 'number' && str(body['code']) !== null;
}
