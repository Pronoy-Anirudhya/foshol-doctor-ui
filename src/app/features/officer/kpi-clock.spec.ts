import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { APP_CONFIG } from '../../core/config/app-config';
import { provideI18n } from '../../core/i18n/i18n.providers';
import { KpiClock } from './kpi-clock';

/**
 * `REVIEW-FR-090` / `REVIEW-FR-091` — the operational clocks.
 *
 * The two cases that matter most are the ones the running server produces today: a row with no
 * due instant at all, and a row whose instant is in the past. The first must render NOTHING —
 * not a dash, not an empty chip, not `Invalid Date` — and the second must be unmistakable
 * without relying on colour.
 */
const NOW = Date.parse('2026-09-08T06:00:00Z');
const MINUTE_MS = APP_CONFIG.ui.msPerSecond * APP_CONFIG.ui.secondsPerMinute;

describe('KpiClock (REVIEW-FR-090 / REVIEW-FR-091)', () => {
  let fixture: ComponentFixture<KpiClock>;

  async function render(dueAt: string | null): Promise<HTMLElement> {
    fixture.componentRef.setInput('dueAt', dueAt);
    fixture.componentRef.setInput('labelKey', 'officer.kpi.assignment');
    fixture.componentRef.setInput('now', NOW);
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [provideI18n()] });
    fixture = TestBed.createComponent(KpiClock);
    await fixture.whenStable();
  });

  it('renders nothing at all when the server sent no due instant', async () => {
    const host = await render(null);

    expect(host.querySelector('[data-testid="kpi-clock"]')).toBeNull();
    expect(host.textContent?.trim()).toBe('');
  });

  it('renders nothing rather than Invalid Date for an unparseable instant', async () => {
    const host = await render('not-a-timestamp');

    expect(host.querySelector('[data-testid="kpi-clock"]')).toBeNull();
    expect(host.textContent ?? '').not.toContain('Invalid');
  });

  it('stays quiet while there is plenty of time left', async () => {
    const host = await render(new Date(NOW + APP_CONFIG.review.kpiWarnMs * 2).toISOString());

    expect(host.querySelector('[data-testid="kpi-clock"]')?.getAttribute('data-tone')).toBe(
      'normal',
    );
    // WEB-UX-044 — no warning words means no warning glyph either; the two never disagree.
    expect(host.querySelector('[data-testid="kpi-tone"]')).toBeNull();
  });

  it('warns, then escalates, as the due instant approaches', async () => {
    const warn = await render(
      new Date(NOW + APP_CONFIG.review.kpiWarnMs - MINUTE_MS).toISOString(),
    );
    expect(warn.querySelector('[data-testid="kpi-clock"]')?.getAttribute('data-tone')).toBe('warn');

    const critical = await render(
      new Date(NOW + APP_CONFIG.review.kpiCriticalMs - MINUTE_MS).toISOString(),
    );
    expect(critical.querySelector('[data-testid="kpi-clock"]')?.getAttribute('data-tone')).toBe(
      'critical',
    );
  });

  it('says it is overdue in words, not only in colour (WEB-UX-044)', async () => {
    const host = await render(new Date(NOW - MINUTE_MS).toISOString());

    expect(host.querySelector('[data-testid="kpi-clock"]')?.getAttribute('data-tone')).toBe(
      'overdue',
    );
    expect((host.querySelector('[data-testid="kpi-tone"]')?.textContent ?? '').trim().length)
      .toBeGreaterThan(0);
  });

  it('never colours a decided task, whose due instant is only history', async () => {
    fixture.componentRef.setInput('live', false);
    const host = await render(new Date(NOW - MINUTE_MS).toISOString());

    expect(host.querySelector('[data-testid="kpi-clock"]')?.getAttribute('data-tone')).toBe(
      'normal',
    );
  });
});
