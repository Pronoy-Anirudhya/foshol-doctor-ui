/**
 * The farmer-provision URLs, in one place.
 *
 * ONE feature, mounted twice (`WEB-FR-310`): the officer console and the admin surface load the
 * same `FarmersPage` at their own path. They live here rather than in either routes file for
 * the reason `officer-paths.ts` gives — the routes files import the page, and the page needs a
 * path to link to, which would close the circle.
 *
 * Which of the two a given user is on is a matter of the URL they arrived at, never a claim
 * about their role: the role comes from `SessionStore`, and `app.routes.ts` has already refused
 * anyone who should not be here (`WEB-SEC-002`).
 */
export const FARMERS_PATHS = {
  officer: '/officer/farmers',
  admin: '/admin/farmers',
} as const;
