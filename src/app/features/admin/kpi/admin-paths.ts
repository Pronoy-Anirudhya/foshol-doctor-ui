/**
 * The admin surface's URLs, in one place.
 *
 * They live beside the pages rather than in `admin.routes.ts` because the routes file imports
 * the components, and the components need the paths to link to one another — putting the
 * constants in the routes file would close that circle. Same reasoning, same shape, as the
 * console's `officer-paths.ts`.
 */
export const ADMIN_PATHS = {
  stats: '/admin/stats',
  /** The KPI dashboard: two district totals plus the per-officer resolution breakdown. */
  kpis: '/admin/kpis',
  /** The drill-down. `kind` and `officerId` are query parameters, never a district. */
  breaches: '/admin/kpis/breaches',
} as const;
