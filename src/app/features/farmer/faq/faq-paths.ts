/**
 * The router URLs this surface navigates to.
 *
 * Declared here rather than imported from `farmer.routes.ts` — the same contract
 * `capture/farmer-paths.ts` already keeps. Keep these in step with the route table by hand.
 */
export const FAQ_PATHS = {
  self: '/farmer/faq',
  /** The real diagnosis path. FAQ never submits a case; it only points at the one that does. */
  newCase: '/farmer/new',
  cases: '/farmer/cases',
} as const;
