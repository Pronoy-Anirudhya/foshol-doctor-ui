import { TestBed } from '@angular/core/testing';
import {
  TranslateLoader,
  provideTranslateLoader,
  provideTranslateService,
  type TranslationObject,
} from '@ngx-translate/core';
import { Observable, of } from 'rxjs';
import { BN_CATALOGUE } from '../../../core/i18n/bn-catalogue';
import type { CaseStatus } from '../../../generated/models/case-status';
import { StatusStepper } from './status-stepper';

class BanglaCatalogueLoader extends TranslateLoader {
  override getTranslation(): Observable<TranslationObject> {
    return of(BN_CATALOGUE as TranslationObject);
  }
}

const STEP_COUNT = 5; // four progress statuses plus the outcome node

describe('StatusStepper (WEB-FR-152)', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StatusStepper],
      providers: [
        provideTranslateService({
          lang: 'bn',
          fallbackLang: 'bn',
          loader: provideTranslateLoader(BanglaCatalogueLoader),
        }),
      ],
    }).compileComponents();
  });

  async function render(status: CaseStatus) {
    const fixture = TestBed.createComponent(StatusStepper);
    fixture.componentRef.setInput('status', status);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  const states = (host: HTMLElement) =>
    Array.from(host.querySelectorAll('[data-testid="ss-step"]')).map((step) =>
      step.getAttribute('data-state'),
    );

  const flows = (host: HTMLElement) =>
    Array.from(host.querySelectorAll('[data-testid="ss-connector"]')).map((connector) =>
      connector.getAttribute('data-flow'),
    );

  it('renders the whole machine, not only the part reached so far', async () => {
    const host = await render('SUBMITTED');
    expect(host.querySelectorAll('[data-testid="ss-step"]').length).toBe(STEP_COUNT);
    expect(states(host)).toEqual(['current', 'upcoming', 'upcoming', 'upcoming', 'upcoming']);
  });

  it('marks everything before the current status as done', async () => {
    const host = await render('IN_REVIEW');
    expect(states(host)).toEqual(['done', 'done', 'done', 'current', 'upcoming']);
    expect(host.querySelector('[aria-current="step"]')).not.toBeNull();
  });

  it('shimmers the connector flowing into the current node, and only that one', async () => {
    const host = await render('ANALYSING');
    // The first node has no incoming connector, so its rail is rendered inert.
    expect(flows(host)).toEqual(['none', 'active', 'idle', 'idle', 'idle']);
  });

  it('invents no transition — the outcome stays neutral until the server sends one', async () => {
    const host = await render('ANALYSED');
    const outcome = host.querySelectorAll('[data-testid="ss-step"]')[STEP_COUNT - 1];

    expect(outcome?.getAttribute('data-outcome')).toBe('true');
    expect(outcome?.getAttribute('data-status')).toBeNull();
    expect(outcome?.querySelector('.ss-label')?.textContent).toContain(
      BN_CATALOGUE['badge.status.pending'],
    );
  });

  for (const terminal of ['ADVISED', 'REJECTED', 'FAILED'] as const) {
    it(`renders ${terminal} on the outcome node and stops the shimmer`, async () => {
      const host = await render(terminal);
      const outcome = host.querySelectorAll('[data-testid="ss-step"]')[STEP_COUNT - 1];

      expect(host.getAttribute('data-terminal')).toBe('true');
      expect(outcome?.getAttribute('data-status')).toBe(terminal);
      expect(outcome?.querySelector('.ss-label')?.textContent).toContain(
        BN_CATALOGUE[`badge.status.${terminal}`],
      );
      expect(flows(host)).not.toContain('active');
    });
  }

  it('gives the three terminal outcomes three different glyphs', async () => {
    const shapes = new Set<string>();
    for (const terminal of ['ADVISED', 'REJECTED', 'FAILED'] as const) {
      const host = await render(terminal);
      const outcome = host.querySelectorAll('[data-testid="ss-step"]')[STEP_COUNT - 1];
      shapes.add(outcome?.querySelector('.ss-dot svg')?.outerHTML ?? '');
    }
    expect(shapes.size).toBe(3);
  });
});
