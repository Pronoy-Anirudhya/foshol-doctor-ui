/**
 * The farmer URLs this surface navigates between.
 *
 * `farmer.routes.ts` is owned by another agent (`OWNERS.md`), so these paths are declared —
 * not routed — here, and named so a mismatch is a compile-time grep rather than a dead link
 * discovered on stage. `WEB-API-001` forbids hand-built **API** URLs; these are router paths,
 * which is a different thing entirely.
 */
export const FARMER_PATHS = {
  /** The case list — also where the capture screen's back link returns to. */
  casesList: '/farmer/cases',
  /** The capture stepper: crop, photographs, field, describe, review (`WEB-FR-100`…`150`). */
  newCase: '/farmer/new',
  /** WEB-FR-151 — where a `202` lands. Owned by C-farmer-view. */
  caseStatus: (caseId: string): string => `/farmer/cases/${caseId}`,
} as const;
