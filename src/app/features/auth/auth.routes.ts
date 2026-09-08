import type { Routes } from '@angular/router';

/**
 * WEB-FR-001 — `/auth/**` is the unauthenticated group, with one login per surface:
 * `/auth/farmer` for the phone-OTP flow and `/auth/officer` for the console password flow.
 * `authGuard` picks between them by the attempted path (`auth.guard.ts`).
 *
 * Each page is a separate `loadComponent`, so a farmer never downloads the console login and
 * an officer never downloads the OTP boxes (`WEB-FR-004`).
 */
export const authRoutes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'farmer' },
  {
    path: 'farmer',
    loadComponent: () =>
      import('./farmer-login/farmer-login-page').then((m) => m.FarmerLoginPage),
  },
  {
    path: 'officer',
    loadComponent: () =>
      import('./officer-login/officer-login-page').then((m) => m.OfficerLoginPage),
  },
];
