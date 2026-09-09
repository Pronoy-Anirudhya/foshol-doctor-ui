import type { Routes } from '@angular/router';

/**
 * The farmer surface: land on your own cases → pick a crop → capture → watch the case →
 * read the advisory.
 *
 * `WEB-FR-153` — a bare `/farmer` (which is where `homePathForRole` sends a freshly
 * authenticated farmer, and every subsequent visit) redirects to `cases`, not `new`. Landing
 * a returning farmer directly in a fresh crop picker, with no way to see a case already
 * submitted short of typing the URL, is the whole of what that requirement exists to prevent.
 * `case-history-page.ts` carries its own "submit a new case" control (`WEB-FR-153`'s sibling
 * requirement is satisfied there, not by making the picker the landing page), so this redirect
 * loses nothing a farmer could do before — it only adds the one thing they could not.
 *
 * `WEB-FR-004` — every page is its own `loadComponent`, so the camera and audio pipeline are
 * not downloaded by a farmer who only came back to re-read an advisory.
 *
 * `WEB-FR-151` — a `202` from `POST /cases` navigates to `cases/{caseId}`, which is why the
 * status view is a CHILD of the history list rather than a sibling: at `xl` the list stays on
 * screen beside the open case, and below `xl` the list steps aside so a 360 px screen shows
 * one column (`WEB-UX-030`…`032`). One route tree, two layouts, no duplicated page.
 *
 * `caseId` reaches `CaseStatusPage` as a signal `input()` through
 * `withComponentInputBinding()` (`app.config.ts`), so no component here subscribes to
 * anything (`WEB-NFR-003`).
 *
 * The capture surface declares the URLs it navigates to in
 * `capture/farmer-paths.ts` (`FARMER_PATHS`) because it may not edit this file. These paths
 * are the other half of that contract and must keep matching it: `/farmer/new`,
 * `/farmer/cases/{caseId}`.
 */
export const farmerRoutes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'cases' },
  {
    // A new case IS the stepper, whose first step is the crop. There used to be a standalone
    // crop-picker page here and the stepper then opened on a crop step with that same choice
    // already selected — one decision asked for twice. The picker is gone; its grid lives on
    // as step one.
    path: 'new',
    loadComponent: () => import('./capture/capture-page').then((m) => m.CapturePage),
  },
  // Anything still pointing at the old two-screen URL lands on the stepper rather than a 404.
  { path: 'new/capture', pathMatch: 'full', redirectTo: 'new' },
  {
    path: 'cases',
    loadComponent: () => import('./history/case-history-page').then((m) => m.CaseHistoryPage),
    children: [
      {
        path: ':caseId',
        loadComponent: () => import('./status/case-status-page').then((m) => m.CaseStatusPage),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
