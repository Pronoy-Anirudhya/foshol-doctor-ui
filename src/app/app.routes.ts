import type { Routes } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';
import { roleGuard } from './core/auth/role.guard';

/**
 * WEB-FR-001 — one application, three route groups, routed BY ROLE:
 *   /auth/**     unauthenticated
 *   /farmer/**   FARMER
 *   /officer/**  OFFICER and ADMIN
 *   /admin/**    ADMIN only
 *
 * WEB-FR-004 — the officer and admin groups are lazy-loaded so the farmer bundle does not
 * carry the console.
 *
 * The role is read from the JWT claim, never from the URL (handover §2).
 * This file is frozen after Wave 0.
 */
export const routes: Routes = [
  {
    path: 'auth',
    loadChildren: () => import('./features/auth/auth.routes').then((m) => m.authRoutes),
  },
  {
    path: 'farmer',
    canMatch: [authGuard, roleGuard(['FARMER'])],
    loadChildren: () => import('./features/farmer/farmer.routes').then((m) => m.farmerRoutes),
  },
  {
    path: 'officer',
    canMatch: [authGuard, roleGuard(['OFFICER', 'ADMIN'])],
    loadChildren: () => import('./features/officer/officer.routes').then((m) => m.officerRoutes),
  },
  {
    path: 'admin',
    canMatch: [authGuard, roleGuard(['ADMIN'])],
    loadChildren: () => import('./features/admin/admin.routes').then((m) => m.adminRoutes),
  },
  {
    path: 'not-permitted',
    loadComponent: () =>
      import('./features/auth/not-permitted/not-permitted-page').then((m) => m.NotPermittedPage),
  },
  { path: '', pathMatch: 'full', redirectTo: 'auth' },
  { path: '**', redirectTo: 'auth' },
];
