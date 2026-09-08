import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { SessionStore } from '../../../core/auth/session-store';
import { APP_CONFIG } from '../../../core/config/app-config';
import { LiveAnnouncer } from '../../../core/stores/live-announcer';
import {
  NotificationStore,
  type AppNotification,
  type NotificationKind,
} from '../../../core/stores/notification-store';
import { formatDhakaTime } from '../../../core/time/dhaka-time';
import { Icon, type IconName } from '../icon/icon';

/**
 * WEB-FR-354 / WEB-FR-357 — the notification centre in the header.
 *
 * A toast is an interruption that expires; this is the record of the ones that did. Everything
 * it shows was recorded by `SseDispatcher` from a frame the stream already delivered, so opening
 * the bell issues no request and closing it starts no timer (WEB-FR-356).
 *
 * WEB-UX-046 — deliberately NOT a live region. The application has exactly one, rendered by the
 * shell, so opening the panel announces through `LiveAnnouncer` in the same way the dispatcher
 * does rather than declaring a second one and racing it.
 *
 * WEB-UX-044 — a row's kind is carried by its glyph AND its named kind label, and an unread row
 * carries the word "new", so neither the badge hue nor the row tint is ever the only cue.
 *
 * WEB-UX-013 / COMMON-CON-003 — `titleKey`/`bodyKey` are chrome and are translated; `title` and
 * `body` came from the server and are interpolated verbatim as text (WEB-SEC-005).
 */
const ARIA_KEY_NONE = 'shared.notifications.aria.none';
const ARIA_KEY_UNREAD = 'shared.notifications.aria.unread';
const KIND_KEY_PREFIX = 'shared.notifications.kind.';
const KEY_ANNOUNCE_OPENED = 'shared.notifications.announce.opened';
const KEY_ANNOUNCE_ALL_READ = 'shared.notifications.announce.allRead';

/** `aria-controls` needs a stable id, and the application renders exactly one header bell. */
const PANEL_ID = 'foshol-notification-panel';

const GLYPHS: Readonly<Record<NotificationKind, IconName>> = {
  STATUS: 'hourglass',
  ADVISORY: 'bell',
  REVISION: 'refresh',
  REJECTION: 'warning',
  // No clock glyph exists and `icon.ts` is another agent's file; the hourglass is the closer
  // reading anyway — a KPI warning is time running out, not an error.
  KPI_WARNING: 'hourglass',
};

/** Icon colour only; every row states its kind in words beside the glyph (WEB-UX-044). */
const GLYPH_TONES: Readonly<Record<NotificationKind, string>> = {
  STATUS: 'text-ink-muted',
  ADVISORY: 'text-primary',
  REVISION: 'text-accent',
  REJECTION: 'text-danger',
  KPI_WARNING: 'text-dawn-700',
};

/**
 * The two deep-link targets, one per addressing scheme.
 *
 * The farmer surface is addressed by case id (`/farmer/cases/:caseId`); the console's workspace
 * is addressed by REVIEW TASK id, as a child of the queue (`/officer/queue/tasks/:taskId`), and
 * a KPI warning is the one entry that carries one. Both are re-declared here rather than
 * imported: `shared/` may not import from `features/`, so `features/officer/officer-paths.ts`
 * is out of reach and this constant must be kept in step with it by hand. Route paths are not
 * user-visible strings, so WEB-UX-013 does not apply to them (see `auth.guard.ts`).
 */
const FARMER_CASE_PATH: readonly string[] = ['/farmer', 'cases'];
const OFFICER_TASK_PATH: readonly string[] = ['/officer', 'queue', 'tasks'];
const ROLE_FARMER = 'FARMER';
const KEY_OPEN_CASE = 'shared.notifications.openCase';
const KEY_OPEN_TASK = 'shared.notifications.openTask';

@Component({
  selector: 'foshol-notification-bell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, RouterLink, Icon],
  templateUrl: './notification-bell.html',
  styleUrl: './notification-bell.css',
  host: {
    class: 'relative inline-flex',
    '[style.--nb-arrival]': 'arrivalDuration',
    // Escape closes, and a click anywhere outside closes. Both are document-level because a
    // dropdown that only closes when you find its own button again is a trap on a phone.
    '(document:keydown.escape)': 'close()',
    '(document:click)': 'onDocumentClick($event)',
  },
})
export class NotificationBell {
  private readonly store = inject(NotificationStore);
  private readonly session = inject(SessionStore);
  private readonly announcer = inject(LiveAnnouncer);
  private readonly host = inject(ElementRef<HTMLElement>);

  /** Slate for the officer and admin console, warm neutrals for the farmer surface. */
  readonly tone = input<'light' | 'dark'>('light');

  protected readonly panelId = PANEL_ID;
  protected readonly items = this.store.items;
  protected readonly unreadCount = this.store.unreadCount;
  protected readonly hasUnread = this.store.hasUnread;
  protected readonly isEmpty = this.store.isEmpty;
  protected readonly arrivalPhase = this.store.arrivalPhase;

  /** WEB-NFR-009 — the arrival cue's length is a named constant, handed to CSS as a property. */
  protected readonly arrivalDuration = `${APP_CONFIG.notifications.arrivalHighlightMs}ms`;

  private readonly _open = signal(false);
  protected readonly open = this._open.asReadonly();

  /** The fuller sentence for the accessible name; the badge digit alone is not a label. */
  protected readonly ariaKey = computed(() => (this.hasUnread() ? ARIA_KEY_UNREAD : ARIA_KEY_NONE));
  protected readonly ariaParams = computed(() => ({ count: this.unreadCount() }));

  protected readonly buttonClass = computed(() =>
    this.tone() === 'dark'
      ? 'bg-slate-900/70 text-surface-2 hover:bg-slate-700'
      : 'bg-surface-2 text-ink-muted hover:text-ink',
  );

  /**
   * The badge inverts on the console chrome. `danger` is a deep clay, which sits at only 2.23:1
   * against slate-800 — a dark red on a dark blue-grey reads as a smudge, and a count nobody can
   * see is not a count. A light fill with ink on it is 7.09:1 against the chrome and 7.53:1
   * inside itself, so the pill pops and the digit stays legible. Both pairs are gated.
   */
  protected readonly badgeClass = computed(() =>
    this.tone() === 'dark' ? 'bg-clay-300 text-ink' : 'bg-danger text-on-danger',
  );

  protected toggle(): void {
    const next = !this._open();
    this._open.set(next);
    if (next) this.announcer.announce(KEY_ANNOUNCE_OPENED);
  }

  protected close(): void {
    this._open.set(false);
  }

  protected onDocumentClick(event: Event): void {
    if (!this._open()) return;
    const target = event.target;
    // The click that opened the panel bubbles to the document too; anything inside this host —
    // the button, the list, the dismiss controls — is not an "outside" click.
    if (target instanceof Node && (this.host.nativeElement as HTMLElement).contains(target)) return;
    this._open.set(false);
  }

  protected markAllRead(): void {
    this.store.markAllRead();
    this.announcer.announce(KEY_ANNOUNCE_ALL_READ);
  }

  protected dismiss(id: string): void {
    this.store.dismiss(id);
  }

  protected kindKey(item: AppNotification): string {
    return `${KIND_KEY_PREFIX}${item.kind}`;
  }

  protected glyph(item: AppNotification): IconName {
    return GLYPHS[item.kind];
  }

  protected glyphClass(item: AppNotification): string {
    return `mt-0.5 shrink-0 ${GLYPH_TONES[item.kind]}`;
  }

  /**
   * WEB-DATA-006 — Asia/Dhaka, through the one formatter the whole system converts with. The
   * text is needed twice (visible, and inside the accessible sentence), so it is computed here
   * rather than piped in two places that could drift apart.
   */
  protected timeText(item: AppNotification): string {
    return formatDhakaTime(new Date(item.receivedAtMs));
  }

  protected timeIso(item: AppNotification): string {
    return new Date(item.receivedAtMs).toISOString();
  }

  /**
   * `null` where this role has no route that this entry's id can address — see above.
   *
   * A KPI warning is officer-addressed and deep-links by `reviewTaskId`; everything else is
   * farmer-addressed and deep-links by `caseId`. The role check on each branch is belt and
   * braces: the server sends `kpi` only to officers and `advisory` only to farmers, but a bell
   * row whose link lands on a route the guard refuses is worse than no link.
   */
  protected linkPath(item: AppNotification): string[] | null {
    const role = this.session.role();
    if (item.reviewTaskId !== undefined) {
      return role === null || role === ROLE_FARMER ? null : [...OFFICER_TASK_PATH, item.reviewTaskId];
    }
    if (item.caseId === undefined || role !== ROLE_FARMER) return null;
    return [...FARMER_CASE_PATH, item.caseId];
  }

  /** The link's own wording follows its target: a case opens, a review task opens. */
  protected linkKey(item: AppNotification): string {
    return item.reviewTaskId === undefined ? KEY_OPEN_CASE : KEY_OPEN_TASK;
  }

  /**
   * The resolution deadline, in Asia/Dhaka like every other instant this application shows.
   * The value is the server's frozen `resolutionDueAt`; nothing here recomputes it
   * (WEB-NFR-001), and a value that does not parse simply renders no line.
   */
  protected dueText(item: AppNotification): string | null {
    if (item.dueAt === undefined) return null;
    const due = new Date(item.dueAt);
    return Number.isNaN(due.getTime()) ? null : formatDhakaTime(due);
  }
}
