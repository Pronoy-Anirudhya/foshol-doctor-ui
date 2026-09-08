import type { Routes } from '@angular/router';

/**
 * `WEB-FR-300` — the admin surface is **exactly one read-only stats page**. `/admin` redirects
 * to it, and there is deliberately nothing else to route to.
 *
 * `WEB-FR-004` — the page is its own `loadComponent`, so a farmer's bundle never carries it.
 * `app.routes.ts` already guards this group with `roleGuard(['ADMIN'])`.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * `[DEFERRED]` — deliberately unstarted, not forgotten
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * The following admin screens are specified and cut. Knowledge content is loaded by Flyway seed
 * migrations, `KnowledgeQueryApi` is **read-only**, and the corresponding write endpoints are
 * themselves `[DEFERRED]` — so these screens have nothing to call.
 *
 *   `WEB-FR-900`  CRUD screens for crops and diseases
 *   `WEB-FR-901`  CRUD screens for symptoms and symptom phrases
 *   `WEB-FR-902`  CRUD screens for remedies
 *   `WEB-FR-903`  an editable threshold configuration screen
 *                 (thresholds are properties, not data — plan clarification 20; `WEB-FR-302`
 *                  puts the pair on screen read-only instead)
 *   `WEB-FR-904`  an audit-log viewer
 *                 (the audit columns are written; the reader is cut — `00-common` §1.2)
 *
 * Building any of them would mean inventing an endpoint, which is a blocker rather than a
 * choice (`WEB-API-001`).
 */
export const adminRoutes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'stats' },
  {
    path: 'stats',
    loadComponent: () => import('./stats/admin-stats-page').then((m) => m.AdminStatsPage),
  },
  // Anything else under /admin is the one page, because there is only one page.
  { path: '**', redirectTo: 'stats' },
];
