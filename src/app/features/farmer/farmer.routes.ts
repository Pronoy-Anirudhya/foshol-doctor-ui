import type { Routes } from '@angular/router';

/**
 * The farmer surface: pick a crop → capture → watch the case → read the advisory.
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
 * `/farmer/new/capture`, `/farmer/cases/{caseId}`.
 */
export const farmerRoutes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'new' },
  {
    path: 'new',
    pathMatch: 'full',
    loadComponent: () => import('./crop-picker/crop-picker-page').then((m) => m.CropPickerPage),
  },
  {
    path: 'new/capture',
    loadComponent: () => import('./capture/capture-page').then((m) => m.CapturePage),
  },
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
