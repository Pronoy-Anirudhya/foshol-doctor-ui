import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideI18n } from '../../../core/i18n/i18n.providers';
import { APP_CONFIG } from '../../../core/config/app-config';
import type { Candidate } from '../../../generated/models/candidate';
import { CandidateList } from './candidate-list';

/**
 * The protected wow factor, asserted rather than admired.
 *
 * `WEB-FR-221`/`223` are covered on the bar itself by `WEB-TEST-001`. What this suite protects
 * is the thing that makes the list read as an argument: the full-height rules sit at exactly
 * the same two positions as the lines on every bar, and both come from the ANALYSIS payload
 * rather than from `APP_CONFIG` (`WEB-NFR-011`).
 */
const CANDIDATES: readonly Candidate[] = [
  {
    diseaseId: 'd-1',
    diseaseCode: 'blast',
    diseaseNameBn: '[diseaseNameBn 1]',
    confidence: 0.91,
    rank: 1,
    source: 'MODEL',
  },
  {
    diseaseId: 'd-2',
    diseaseCode: 'brown_spot',
    diseaseNameBn: '[diseaseNameBn 2]',
    // Exactly the low threshold: the boundary WEB-FR-223 names.
    confidence: 0.45,
    rank: 2,
    source: 'MERGED',
  },
];

describe('CandidateList (WEB-FR-220…224, WEB-NFR-011)', () => {
  let fixture: ComponentFixture<CandidateList>;

  async function render(low: number, high: number): Promise<HTMLElement> {
    fixture = TestBed.createComponent(CandidateList);
    fixture.componentRef.setInput('candidates', CANDIDATES);
    fixture.componentRef.setInput('thresholds', { low, high });
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  function rules(host: HTMLElement): HTMLElement[] {
    return Array.from(host.querySelectorAll<HTMLElement>('[data-testid="threshold-rule"]'));
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CandidateList],
      providers: [provideI18n()],
    }).compileComponents();
  });

  it('draws one bar per candidate', async () => {
    const host = await render(0.45, 0.75);

    expect(host.querySelectorAll('foshol-confidence-bar').length).toBe(CANDIDATES.length);
    expect(host.querySelectorAll('[data-testid="candidate"]').length).toBe(CANDIDATES.length);
  });

  it('draws exactly two full-height rules, one per threshold', async () => {
    const host = await render(0.45, 0.75);
    const drawn = rules(host);

    expect(drawn.length).toBe(2);
    expect(drawn.map((rule) => rule.getAttribute('data-threshold'))).toEqual(['low', 'high']);
  });

  it('positions each rule at the SAME percentage its bars use, so they cannot disagree', async () => {
    const host = await render(0.45, 0.75);

    expect(host.style.getPropertyValue('--cl-low')).toBe('45%');
    expect(host.style.getPropertyValue('--cl-high')).toBe('75%');

    for (const bar of Array.from(host.querySelectorAll<HTMLElement>('foshol-confidence-bar'))) {
      expect(bar.style.getPropertyValue('--cb-low')).toBe('45%');
      expect(bar.style.getPropertyValue('--cb-high')).toBe('75%');
    }
  });

  it('reads both thresholds from the input, never from APP_CONFIG (WEB-NFR-011)', async () => {
    // Values chosen so that a component reading the fallback constants would fail here.
    const host = await render(0.3, 0.6);

    expect(APP_CONFIG.analysis.confidenceLowFallback).not.toBe(0.3);
    expect(host.style.getPropertyValue('--cl-low')).toBe('30%');
    expect(host.style.getPropertyValue('--cl-high')).toBe('60%');
    expect(host.textContent).toContain('30%');
    expect(host.textContent).toContain('60%');
  });

  it('stays exact at a boundary, where 0.45 * 100 is not 45 in IEEE-754', async () => {
    const host = await render(0.45, 0.75);
    const boundaryBar = host.querySelectorAll<HTMLElement>('foshol-confidence-bar')[1];

    expect(boundaryBar.style.getPropertyValue('--cb-fill')).toBe('45%');
    expect(host.style.getPropertyValue('--cl-low')).toBe('45%');
  });

  it('names both thresholds as text at the head of the list (WEB-UX-044)', async () => {
    const host = await render(0.45, 0.75);
    const heads = Array.from(host.querySelectorAll('[data-testid="threshold-head"]'));

    expect(heads.length).toBe(2);
    expect(heads.map((head) => head.textContent ?? '').join(' ')).toContain('45%');
    expect(heads.map((head) => head.textContent ?? '').join(' ')).toContain('75%');
  });

  it('implies no decision path — the bars state a number, the badge states the path', async () => {
    const host = await render(0.45, 0.75);

    expect(host.outerHTML).not.toMatch(/PRIMARY|SECONDARY|UNDETERMINED/);
    expect(host.querySelector('foshol-decision-path-badge')).toBeNull();
  });

  it('marks the officer’s chosen disease without relying on colour alone', async () => {
    fixture = TestBed.createComponent(CandidateList);
    fixture.componentRef.setInput('candidates', CANDIDATES);
    fixture.componentRef.setInput('thresholds', { low: 0.45, high: 0.75 });
    fixture.componentRef.setInput('selectedDiseaseId', 'd-2');
    await fixture.whenStable();

    const host = fixture.nativeElement as HTMLElement;
    const selected = host.querySelectorAll<HTMLElement>('[data-testid="candidate"]')[1];

    expect(selected.getAttribute('data-selected')).toBe('true');
  });
});
