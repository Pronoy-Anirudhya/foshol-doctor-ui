import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  TranslateLoader,
  provideTranslateLoader,
  provideTranslateService,
  type TranslationObject,
} from '@ngx-translate/core';
import { Observable, of } from 'rxjs';
import { SessionStore } from '../../../core/auth/session-store';
import { APP_CONFIG } from '../../../core/config/app-config';
import {
  NotificationStore,
  NOTIFY_ADVISORY,
  NOTIFY_STATUS,
} from '../../../core/stores/notification-store';
import { LiveAnnouncer } from '../../../core/stores/live-announcer';
import type { Principal } from '../../../generated/models/principal';
import { NotificationBell } from './notification-bell';

/**
 * A local catalogue rather than the bundled one: `public/i18n` is a build artefact that another
 * agent regenerates, and a view test should fail because the VIEW changed, never because a merge
 * had not been run yet.
 */
const CATALOGUE: Readonly<Record<string, string>> = {
  'shared.notifications.title': 'বিজ্ঞপ্তি',
  'shared.notifications.aria.none': 'বিজ্ঞপ্তি — নতুন কিছু নেই',
  'shared.notifications.aria.unread': 'বিজ্ঞপ্তি — {{count}}টি নতুন',
  'shared.notifications.markAllRead': 'সব পড়া হয়েছে',
  'shared.notifications.unreadMark': 'নতুন',
  'shared.notifications.openCase': 'কেসটি খুলুন',
  'shared.notifications.empty': 'এখনো কোনো বিজ্ঞপ্তি নেই',
  'shared.notifications.kind.ADVISORY': 'পরামর্শ',
};

class LocalCatalogueLoader extends TranslateLoader {
  override getTranslation(): Observable<TranslationObject> {
    return of(CATALOGUE as TranslationObject);
  }
}

function tokenFor(role: Principal['role']): string {
  const payload = btoa(JSON.stringify({ sub: 'u', role, exp: 9_999_999_999 }));
  return `header.${payload}.signature`;
}

describe('NotificationBell (WEB-FR-354, WEB-UX-044, WEB-UX-046)', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NotificationBell],
      providers: [
        provideRouter([]),
        provideTranslateService({
          lang: 'bn',
          fallbackLang: 'bn',
          loader: provideTranslateLoader(LocalCatalogueLoader),
        }),
      ],
    }).compileComponents();
  });

  afterEach(() => TestBed.resetTestingModule());

  async function render() {
    const fixture = TestBed.createComponent(NotificationBell);
    await fixture.whenStable();
    return {
      fixture,
      host: fixture.nativeElement as HTMLElement,
      store: TestBed.inject(NotificationStore),
      announcer: TestBed.inject(LiveAnnouncer),
      session: TestBed.inject(SessionStore),
    };
  }

  const button = (host: HTMLElement) => host.querySelector('button') as HTMLButtonElement;

  it('shows no badge until something has arrived, and says so in words', async () => {
    const { host } = await render();

    expect(host.querySelector('.nb-badge')).toBeNull();
    expect(button(host).getAttribute('aria-label')).toBe(CATALOGUE['shared.notifications.aria.none']);
    expect(button(host).getAttribute('aria-expanded')).toBe('false');
  });

  it('carries the unread count in the accessible name, not only in the badge hue', async () => {
    const { fixture, host, store } = await render();
    store.record({ kind: NOTIFY_ADVISORY, title: 'পরামর্শ প্রস্তুত' });
    store.record({ kind: NOTIFY_STATUS, titleKey: 'live.case.statusChanged' });
    await fixture.whenStable();

    expect(host.querySelector('.nb-badge')?.textContent?.trim()).toBe('2');
    expect(button(host).getAttribute('aria-label')).toBe('বিজ্ঞপ্তি — 2টি নতুন');
  });

  it('drives the arrival animation from an attribute that flips, not from a timer', async () => {
    const { fixture, host, store } = await render();
    store.record({ kind: NOTIFY_STATUS });
    await fixture.whenStable();
    const first = host.querySelector('.nb-badge')?.getAttribute('data-arrival');

    store.record({ kind: NOTIFY_STATUS });
    await fixture.whenStable();

    expect(first).not.toBeNull();
    expect(host.querySelector('.nb-badge')?.getAttribute('data-arrival')).not.toBe(first);
    // WEB-NFR-009 — the cue's length reaches CSS from the config file, never from a stylesheet
    // literal. If this binding ever silently stopped applying, the cue would still run and only
    // this assertion would notice.
    expect(host.style.getPropertyValue('--nb-arrival')).toBe(
      `${APP_CONFIG.notifications.arrivalHighlightMs}ms`,
    );
  });

  it('opens on click and announces through the one shared live region (WEB-UX-046)', async () => {
    const { fixture, host, announcer } = await render();

    button(host).click();
    await fixture.whenStable();

    expect(button(host).getAttribute('aria-expanded')).toBe('true');
    expect(announcer.message()?.key).toBe('shared.notifications.announce.opened');
    // The shell renders the application's only live region; a second one here would race it.
    expect(host.querySelectorAll('[aria-live]')).toHaveLength(0);
  });

  it('offers the inbox empty state when nothing has arrived', async () => {
    const { fixture, host } = await render();
    button(host).click();
    await fixture.whenStable();

    expect(host.querySelector('foshol-icon[name="inbox"]')).not.toBeNull();
    expect(host.textContent).toContain(CATALOGUE['shared.notifications.empty']);
  });

  it('closes on Escape', async () => {
    const { fixture, host } = await render();
    button(host).click();
    await fixture.whenStable();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await fixture.whenStable();

    expect(button(host).getAttribute('aria-expanded')).toBe('false');
  });

  it('closes on an outside click but not on a click inside the panel', async () => {
    const { fixture, host, store } = await render();
    store.record({ kind: NOTIFY_ADVISORY, title: 'পরামর্শ প্রস্তুত' });
    button(host).click();
    await fixture.whenStable();

    host.querySelector('h2')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await fixture.whenStable();
    expect(button(host).getAttribute('aria-expanded')).toBe('true');

    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await fixture.whenStable();
    expect(button(host).getAttribute('aria-expanded')).toBe('false');
  });

  it('marks every row read without discarding any of them', async () => {
    const { fixture, host, store } = await render();
    store.record({ kind: NOTIFY_ADVISORY, title: 'পরামর্শ প্রস্তুত' });
    button(host).click();
    await fixture.whenStable();

    const markAll = [...host.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === CATALOGUE['shared.notifications.markAllRead'],
    );
    markAll?.click();
    await fixture.whenStable();

    expect(store.unreadCount()).toBe(0);
    expect(store.items()).toHaveLength(1);
    expect(host.querySelector('.nb-badge')).toBeNull();
  });

  it('renders a server-supplied title verbatim and never as HTML (WEB-SEC-005)', async () => {
    const { fixture, host, store } = await render();
    store.record({ kind: NOTIFY_ADVISORY, title: '<b>পরামর্শ</b>', body: 'বিস্তারিত' });
    button(host).click();
    await fixture.whenStable();

    expect(host.querySelector('li b')).toBeNull();
    expect(host.textContent).toContain('<b>পরামর্শ</b>');
  });

  it('deep-links a farmer to the case, because that surface has a route for a case id', async () => {
    const { fixture, host, store, session } = await render();
    session.signIn(tokenFor('FARMER'), { id: 'u-1', name: 'Demo', role: 'FARMER' }, new Date());
    store.record({ kind: NOTIFY_ADVISORY, title: 'পরামর্শ', caseId: 'c-1' });
    button(host).click();
    await fixture.whenStable();

    const link = host.querySelector('li a') as HTMLAnchorElement | null;
    expect(link?.getAttribute('href')).toBe('/farmer/cases/c-1');
  });

  it('offers no link to an officer, whose workspace is addressed by a review task id', async () => {
    const { fixture, host, store, session } = await render();
    session.signIn(tokenFor('OFFICER'), { id: 'u-2', name: 'Officer', role: 'OFFICER' }, new Date());
    store.record({ kind: NOTIFY_ADVISORY, title: 'পরামর্শ', caseId: 'c-1' });
    button(host).click();
    await fixture.whenStable();

    expect(host.querySelector('li a')).toBeNull();
    expect(host.textContent).toContain('পরামর্শ');
  });

  it('is a header control, never a blocking overlay', async () => {
    const { fixture, host } = await render();
    button(host).click();
    await fixture.whenStable();

    const panel = host.querySelector('.nb-panel');
    expect(panel?.className).not.toContain('inset-0');
    expect(host.querySelector('[aria-modal="true"]')).toBeNull();
  });
});
