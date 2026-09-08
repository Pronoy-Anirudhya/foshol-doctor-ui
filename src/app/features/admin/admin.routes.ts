import type { Routes } from '@angular/router';

/**
 * `WEB-FR-300` — the admin surface: the read-only stats page, and the KPI dashboard beside it.
 * `/admin` redirects to the stats page, which links on to the KPIs.
 *
 * The KPI screens are additive and separate on purpose. `/admin/stats` and its spec describe a
 * page with exactly four tiles and no controls but a refresh; folding a second endpoint's
 * numbers into it would make one screen answer two different questions at two different
 * freshnesses. So the KPI summary and its breach drill-down are their own routes, their own
 * lazy chunks and their own stores — a 500 on either KPI endpoint (which is what the running
 * backend answers today) cannot touch the stats page at all.
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
  {
    // The case list is its own route, reachable from the left nav, rather than embedded in the
    // dashboard — a dense filterable table and a stat-tile grid are two different reading modes.
    path: 'cases',
    loadComponent: () => import('./cases/admin-cases-page').then((m) => m.AdminCasesPage),
  },
  {
    // The KPI drill-down is a SIBLING of the summary rather than a child: it is a whole screen
    // of its own at every width, and nesting it would put a table inside a dashboard on a phone.
    path: 'kpis/breaches',
    loadComponent: () => import('./kpi/kpi-breaches-page').then((m) => m.KpiBreachesPage),
  },
  {
    path: 'kpis',
    loadComponent: () => import('./kpi/admin-kpi-page').then((m) => m.AdminKpiPage),
  },
  // Anything else under /admin lands on the stats page.
  { path: '**', redirectTo: 'stats' },
];
