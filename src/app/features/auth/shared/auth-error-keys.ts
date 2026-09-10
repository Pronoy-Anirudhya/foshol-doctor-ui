import type { ProblemView } from '../../../core/errors/problem';

/**
 * Contract error codes on the login screens → the translation key that explains each one *here*.
 *
 * `problem.ts` maps a STATUS to friendly copy, which is right almost everywhere. Login is where
 * that breaks down: a `404` on `POST /auth/otp/request` means "this number is not a registered
 * farmer", and the generic `errors.notFound` copy — "It may have moved, or it may not be yours" —
 * says nothing a farmer can act on.
 *
 * **Why a translated string wins over the server's own `detail` on this one screen.** RFC 9457
 * `detail` is normally the better message and `ProblemNotice` prefers it everywhere else. But the
 * identity module hardcodes this one in English (`"Farmer was not found."`) and does no
 * `Accept-Language` negotiation, while Bangla is this application's language of record
 * (`WEB-UX-011`) and this is the first screen a farmer who may not read English ever meets. So for
 * a code named here, the catalogue wins; every other problem passes through untouched.
 */
const KEYS: ReadonlyMap<string, string> = new Map([
  ['ERR_FARMER_NOT_FOUND', 'auth.farmer.notRegistered'],
]);

/**
 * The problem to render, with `title`/`detail` cleared when we have better copy of our own so that
 * `ProblemNotice`'s existing precedence — server text first, catalogue second — resolves to ours.
 *
 * Returns the problem unchanged when the code is one we have nothing special to say about, which
 * is the common case and the safe default.
 */
export function localiseAuthProblem(problem: ProblemView | null): ProblemView | null {
  if (problem === null) return problem;
  const key = problem.code === null ? undefined : KEYS.get(problem.code);
  if (key === undefined) return problem;
  return { ...problem, title: null, detail: null, titleKey: `${key}.title`, detailKey: `${key}.detail` };
}
