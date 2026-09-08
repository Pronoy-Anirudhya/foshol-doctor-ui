import type { Routes } from '@angular/router';
import { OFFICER_PATHS } from './officer-paths';
import { OfficerQueuePage } from './queue/officer-queue-page';
import { CaseWorkspacePage } from './workspace/case-workspace-page';

/**
 * The officer console. `app.routes.ts` lazy-loads this file behind `authGuard` and
 * `roleGuard(['OFFICER', 'ADMIN'])`, so nothing here re-checks a role (`WEB-FR-001`).
 *
 * The workspace is a **child** of the queue, not a sibling. That is what lets `WEB-UX-030`'s
 * 1280 px layout be a real two-pane console — queue left, case detail right, both live at
 * once — rather than two screens that replace each other. Below `xl` the queue pane hides
 * itself while a case is open, so the same route tree serves a phone.
 *
 * `withComponentInputBinding()` (see `app.config.ts`) delivers `:taskId` to the workspace as a
 * signal input, which is why no component here subscribes to anything.
 */
export const officerRoutes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'queue' },
  {
    path: 'queue',
    component: OfficerQueuePage,
    children: [
      {
        path: `${OFFICER_PATHS.taskSegment}/:taskId`,
        component: CaseWorkspacePage,
      },
    ],
  },
  { path: '**', redirectTo: 'queue' },
];
