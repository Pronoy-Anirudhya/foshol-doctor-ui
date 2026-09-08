import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { HTTP_STATUS, isProblem, toProblemView } from './problem';

const ID = '01a07caa-d705-7ad0-a51b-f334668c9f99';

const failure = (init: {
  status: number;
  error?: unknown;
  headers?: Record<string, string>;
}): HttpErrorResponse =>
  new HttpErrorResponse({
    status: init.status,
    statusText: 'Error',
    url: 'http://localhost:8080/api/v1/cases',
    error: init.error ?? null,
    headers: new HttpHeaders(init.headers ?? {}),
  });

describe('toProblemView', () => {
  it('maps an RFC 9457 document field by field (WEB-FR-005)', () => {
    const view = toProblemView(
      failure({
        status: HTTP_STATUS.badRequest,
        error: {
          type: 'https://foshol.local/problems/err-example',
          title: 'Bad Request',
          status: 400,
          detail: 'Human-readable explanation.',
          code: 'ERR_EXAMPLE',
          correlationId: ID,
          errors: [{ field: 'phone', message: 'must be E.164' }],
        },
      }),
    );

    expect(view.status).toBe(HTTP_STATUS.badRequest);
    expect(view.code).toBe('ERR_EXAMPLE');
    expect(view.title).toBe('Bad Request');
    expect(view.detail).toBe('Human-readable explanation.');
    expect(view.correlationId).toBe(ID);
    expect(view.fieldErrors).toEqual([{ field: 'phone', message: 'must be E.164' }]);
    expect(view.retryable).toBe(false);
  });

  it('parses a problem body that arrived as text', () => {
    const view = toProblemView(
      failure({
        status: HTTP_STATUS.conflict,
        error: JSON.stringify({ code: 'ERR_CONFLICT', title: 'Conflict', correlationId: ID }),
      }),
    );
    expect(view.code).toBe('ERR_CONFLICT');
    expect(view.correlationId).toBe(ID);
    expect(view.titleKey).toBe('errors.conflict.title');
  });

  it('reads Retry-After onto a 429 (WEB-FR-011)', () => {
    const view = toProblemView(
      failure({ status: HTTP_STATUS.tooManyRequests, headers: { 'Retry-After': '45' } }),
    );
    expect(view.retryAfterSeconds).toBe(45);
    expect(view.titleKey).toBe('errors.rateLimited.title');
  });

  it('marks a 503 retryable but retries nothing itself (WEB-FR-401)', () => {
    const view = toProblemView(failure({ status: HTTP_STATUS.serviceUnavailable }));
    expect(view.retryable).toBe(true);
    expect(view.titleKey).toBe('errors.unavailable.title');
    expect(view.detailKey).toBe('errors.unavailable.detail');
  });

  it('gives a network failure its own offline view, never a browser message (WEB-FR-402)', () => {
    const view = toProblemView(
      failure({
        status: HTTP_STATUS.networkFailure,
        error: new ProgressEvent('error'),
      }),
    );
    expect(view.titleKey).toBe('errors.offline.title');
    expect(view.title).toBeNull();
    expect(view.detail).toBeNull();
    expect(view.retryable).toBe(true);
  });

  it('parses the 422 quality-gate rejections', () => {
    const view = toProblemView(
      failure({
        status: HTTP_STATUS.unprocessable,
        error: {
          code: 'ERR_IMAGE_QUALITY',
          title: 'Unprocessable Content',
          correlationId: ID,
          rejectedImages: [
            { position: 1, reason: 'BLURRY', messageBn: 'ছবিটি ঝাপসা' },
            { position: 2, reason: 'TOO_SMALL' },
          ],
        },
      }),
    );

    expect(view.rejectedImages).toEqual([
      { position: 1, reason: 'BLURRY', messageBn: 'ছবিটি ঝাপসা' },
      { position: 2, reason: 'TOO_SMALL', messageBn: null },
    ]);
    expect(view.titleKey).toBe('errors.quality.title');
  });

  it('discards a non-problem body rather than showing it (WEB-FR-404)', () => {
    const view = toProblemView(failure({ status: 500, error: '<html>Proxy Error</html>' }));
    expect(view.title).toBeNull();
    expect(view.detail).toBeNull();
    expect(view.titleKey).toBe('errors.generic.title');
  });

  it('reduces a non-HTTP error to the generic view with no leaked message', () => {
    const view = toProblemView(new TypeError('x.y is not a function'));
    expect(view.title).toBeNull();
    expect(view.detail).toBeNull();
    expect(view.status).toBe(HTTP_STATUS.networkFailure);
    expect(view.titleKey).toBe('errors.generic.title');
  });

  it('falls back to the response header for the correlation id', () => {
    const view = toProblemView(
      failure({ status: HTTP_STATUS.notFound, headers: { 'X-Correlation-Id': ID } }),
    );
    // WEB-API-002 — 404 is "not found or not yours"; nothing infers existence from it.
    expect(view.titleKey).toBe('errors.notFound.title');
    expect(view.correlationId).toBe(ID);
  });
});

describe('isProblem', () => {
  it('accepts a contract-shaped document and rejects anything else', () => {
    expect(isProblem({ code: 'ERR_X', status: 400, title: 'T', correlationId: ID })).toBe(true);
    expect(isProblem({ message: 'nope' })).toBe(false);
    expect(isProblem('<html>')).toBe(false);
    expect(isProblem(null)).toBe(false);
  });
});
