/**
 * The console's URLs, in one place.
 *
 * They live here rather than in `officer.routes.ts` because the facade navigates and the
 * routes file imports the components that inject the facade — putting the constants in the
 * routes file would close that circle.
 */
export const OFFICER_PATHS = {
  queue: '/officer/queue',
  /** The workspace is a CHILD of the queue route: at 1280 px both panes are on screen at once. */
  taskSegment: 'tasks',
} as const;

export function taskPath(taskId: string): string {
  return `${OFFICER_PATHS.queue}/${OFFICER_PATHS.taskSegment}/${taskId}`;
}
