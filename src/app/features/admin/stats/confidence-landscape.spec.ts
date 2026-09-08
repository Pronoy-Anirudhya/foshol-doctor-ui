import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';
import { APP_CONFIG } from '../../../core/config/app-config';
import { provideI18n } from '../../../core/i18n/i18n.providers';
import adminFragment from '../../../../i18n/admin.i18n.json';
import type { OfficerQueueRow } from '../../../generated/models/officer-queue-row';
import type { PageOfOfficerQueueRow } from '../../../generated/models/page-of-officer-queue-row';
import { toQueueInsightView, type QueueInsightView } from '../queue-insight.adapter';
import { ConfidenceLandscape } from './confidence-landscape';

const LOW = 0.45;
const HIGH = 0.75;
const LOW_TEXT = '45%';
const HIGH_TEXT = '75%';
const BINS = APP_CONFIG.admin.confidenceBins;

let seq = 0;
const row = (overrides: Partial<OfficerQueueRow> = {}): OfficerQueueRow => ({
  caseId: `c-${(seq += 1)}`,
  reviewTaskId: `t-${seq}`,
  state: 'PENDING',
  submittedAt: '2026-09-08T06:00:00Z',
  slaDueAt: '2026-09-08T18:00:00Z',
  ...overrides,
});

function insightOf(rows: readonly OfficerQueueRow[]): QueueInsightView {
  const page: PageOfOfficerQueueRow = {
    page: 0,
    size: APP_CONFIG.admin.sampleSize,
    totalElements: rows.length,
    totalPages: 1,
    content: [...rows],
  };
  return toQueueInsightView(page, Date.parse('2026-09-08T12:00:00Z'));
}

async function render(insight: QueueInsightView | null): Promise<HTMLElement> {
  const fixture = TestBed.createComponent(ConfidenceLandscape);
  fixture.componentRef.setInput('low', LOW);
  fixture.componentRef.setInput('high', HIGH);
  fixture.componentRef.setInput('landscape', insight?.confidence ?? null);
  fixture.componentRef.setInput('tallies', insight?.bands ?? null);
  fixture.componentRef.setInput('unrouted', insight?.bandUnrouted ?? 0);
  fixture.componentRef.setInput('rowsLoaded', insight?.rowsLoaded ?? 0);
  fixture.componentRef.setInput('totalElements', insight?.totalElements ?? 0);
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

const all = (host: HTMLElement, selector: string): HTMLElement[] => [
  ...host.querySelectorAll<HTMLElement>(selector),
];

const text = (host: HTMLElement, selector: string): string =>
  host.querySelector(selector)?.textContent?.trim() ?? '';

/**
 * `public/i18n/*.json` is a committed BUILD ARTEFACT of the `src/i18n/*.i18n.json` fragments,
 * so a spec reading only the artefact goes red on every string added before the next
 * `i18n:build`. The owning fragment is merged in instead — which also asserts the shipped
 * Bangla rather than a stale copy of it.
 */
function mergeAdminCatalogue(): void {
  const bn = Object.fromEntries(
    Object.entries(adminFragment).map(([key, value]) => [key, value.bn]),
  );
  TestBed.inject(TranslateService).setTranslation(APP_CONFIG.i18n.defaultLocale, bn, true);
}

describe('ConfidenceLandscape (WEB-FR-302, WEB-UX-044)', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideI18n()],
    });
    mergeAdminCatalogue();
  });

  describe('the two thresholds', () => {
    it('draws one rule per threshold at exactly its proportional position', async () => {
      const host = await render(insightOf([row({ topConfidence: 0.5 })]));

      // The boundary percent.ts exists for: 0.45 * 100 is not 45 in IEEE-754.
      expect(host.style.getPropertyValue('--cl-low')).toBe(LOW_TEXT);
      expect(host.style.getPropertyValue('--cl-high')).toBe(HIGH_TEXT);
      expect(all(host, '[data-testid="cl-rule"]').length).toBe(2);
      expect(
        all(host, '[data-testid="cl-rule"]').map((r) => r.getAttribute('data-threshold')),
      ).toEqual(['low', 'high']);
    });

    it('states both values as text, so neither is read by position alone', async () => {
      const host = await render(insightOf([row({ topConfidence: 0.5 })]));

      expect(all(host, '[data-testid="cl-rule-label"]').map((l) => l.textContent?.trim())).toEqual([
        LOW_TEXT,
        HIGH_TEXT,
      ]);
      expect(text(host, '[data-testid="threshold-low"]')).toBe(LOW_TEXT);
      expect(text(host, '[data-testid="threshold-high"]')).toBe(HIGH_TEXT);
    });

    it('exposes both values in one accessible name', async () => {
      const host = await render(insightOf([row({ topConfidence: 0.5 })]));
      const figure = host.querySelector('[role="img"]');

      expect(figure?.getAttribute('aria-label')).toContain(LOW_TEXT);
      expect(figure?.getAttribute('aria-label')).toContain(HIGH_TEXT);
    });
  });

  describe('the three bands', () => {
    it('tiles the rail exactly, whatever the thresholds are', async () => {
      const host = await render(insightOf([row({ topConfidence: 0.5 })]));

      expect(all(host, '.cl-rail-seg').map((s) => s.style.width)).toEqual(['45%', '30%', '25%']);
    });

    it('names each band in text, in ascending-confidence order', async () => {
      const host = await render(insightOf([row({ topConfidence: 0.5 })]));

      expect(
        all(host, 'foshol-decision-path-badge').map((b) => b.getAttribute('data-path')),
      ).toEqual(['UNDETERMINED', 'SECONDARY', 'PRIMARY']);
    });

    it('tallies each band from the server decisionPath, never from the confidence', async () => {
      // Confidences that a client re-bucketing against 45/75 would route the other way round.
      const host = await render(
        insightOf([
          row({ topConfidence: 0.91, decisionPath: 'UNDETERMINED' }),
          row({ topConfidence: 0.1, decisionPath: 'PRIMARY' }),
        ]),
      );

      const counts = all(host, '[data-testid="cl-band-count"]').map((c) => c.textContent ?? '');
      expect(counts.length).toBe(3);
      // UNDETERMINED 1, SECONDARY 0, PRIMARY 1 — as routed, not as re-bucketed.
      expect(counts[0]).toContain('1');
      expect(counts[1]).toContain('0');
      expect(counts[2]).toContain('1');
      expect(all(host, '[data-testid="cl-band"]').length).toBe(3);
    });

    it('reports an unrouted row as text rather than as a fourth band', async () => {
      const host = await render(insightOf([row({ topConfidence: 0.5 })]));

      expect(host.querySelector('[data-testid="cl-unrouted"]')).not.toBeNull();
      expect(all(host, '[data-testid="cl-band"]').length).toBe(3);
    });
  });

  /**
   * The boundary cases inherited from the deleted `threshold-track.spec.ts`, now asserted on
   * the drawing that carries them. 20 bins is chosen so 0.45 × 20 = 9 and 0.75 × 20 = 15 are
   * integers: each rule lands on a bin EDGE and can never bisect a bar.
   */
  describe('boundary confidences', () => {
    const CASES = [
      { name: 'zero', confidence: 0, position: '0%', bin: 0 },
      { name: 'exactly the low threshold', confidence: LOW, position: LOW_TEXT, bin: 9 },
      { name: 'strictly between the thresholds', confidence: 0.6, position: '60%', bin: 12 },
      { name: 'exactly the high threshold', confidence: HIGH, position: HIGH_TEXT, bin: 15 },
      { name: 'one', confidence: 1, position: '100%', bin: BINS - 1 },
    ];

    for (const boundary of CASES) {
      it(`puts ${boundary.name} at ${boundary.position} on the rug and in one bin`, async () => {
        const host = await render(insightOf([row({ topConfidence: boundary.confidence })]));

        const ticks = all(host, '[data-testid="cl-tick"]');
        expect(ticks.length).toBe(1);
        expect(ticks[0]?.style.getPropertyValue('--cl-x')).toBe(boundary.position);

        // Exactly one bar exists, and it is in the cell the threshold arithmetic predicts.
        const cells = all(host, '.cl-cell');
        expect(cells.length).toBe(BINS);
        expect(all(host, '[data-testid="cl-bar"]').length).toBe(1);
        expect(cells[boundary.bin]?.querySelector('[data-testid="cl-bar"]')).not.toBeNull();
      });
    }

    it('gives every bar a height relative to the fullest bin, never a zero-height one', async () => {
      const host = await render(
        insightOf([
          row({ topConfidence: 0.1 }),
          row({ topConfidence: 0.11 }),
          row({ topConfidence: 0.9 }),
        ]),
      );

      const bars = all(host, '[data-testid="cl-bar"]');
      expect(bars.length).toBe(2);
      expect(bars.map((b) => b.style.getPropertyValue('--cl-h'))).toEqual(['100%', '50%']);
      // The peak is marked as well as named, so the highlight is never the only signal.
      expect(bars.filter((b) => b.hasAttribute('data-peak')).length).toBe(1);
    });
  });

  describe('the three empty states', () => {
    it('(a) draws the bands from the thresholds alone when the queue never loaded', async () => {
      const host = await render(null);

      expect(host.querySelector('[data-testid="cl-unavailable"]')).not.toBeNull();
      expect(all(host, '[data-testid="cl-bar"]').length).toBe(0);
      expect(all(host, '[data-testid="cl-tick"]').length).toBe(0);
      // The routing story still stands: it comes from /admin/stats, which is unaffected.
      expect(all(host, '.cl-rail-seg').map((s) => s.style.width)).toEqual(['45%', '30%', '25%']);
      expect(text(host, '[data-testid="threshold-low"]')).toBe(LOW_TEXT);
      expect(all(host, '[data-testid="cl-band-count"]').length).toBe(0);
    });

    it('(b) says the page is empty rather than drawing a flat histogram', async () => {
      const host = await render(insightOf([]));

      expect(host.querySelector('[data-testid="cl-no-rows"]')).not.toBeNull();
      expect(all(host, '[data-testid="cl-bar"]').length).toBe(0);
    });

    it('(c) says so when rows exist but not one carries a confidence', async () => {
      const host = await render(
        insightOf([row({ topConfidence: null }), row({ topConfidence: null })]),
      );

      expect(host.querySelector('[data-testid="cl-no-confidence"]')).not.toBeNull();
      expect(all(host, '[data-testid="cl-bar"]').length).toBe(0);
      expect(all(host, '[data-testid="cl-tick"]').length).toBe(0);
    });

    it('counts unscored rows alongside a drawn histogram', async () => {
      const host = await render(
        insightOf([row({ topConfidence: 0.5 }), row({ topConfidence: null })]),
      );

      expect(host.querySelector('[data-testid="cl-unscored"]')).not.toBeNull();
      expect(all(host, '[data-testid="cl-tick"]').length).toBe(1);
    });
  });

  it('has no control of any kind — it is a read-only graphic (WEB-FR-303)', async () => {
    const host = await render(insightOf([row({ topConfidence: 0.5 })]));

    for (const selector of ['form', 'input', 'textarea', 'select', 'button']) {
      expect(host.querySelector(selector)).toBeNull();
    }
  });
});
