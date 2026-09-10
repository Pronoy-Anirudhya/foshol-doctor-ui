import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideI18n } from '../../../core/i18n/i18n.providers';
import type { Remedy } from '../../../generated/models/remedy';
import { FaqRemedyList } from './faq-remedy-list';

/**
 * The catalogue is rendered, not interpreted.
 *
 * Every assertion here is about the UI refusing to add anything: no invented dose where the
 * catalogue has none, no reordering of steps, no reworded text, no chemical row hidden among
 * non-chemical ones. `COMMON-CON-003` — a wrong dosage is not a bug, it is harm — so the tests
 * are written to fail the moment this component starts having opinions.
 */
function remedy(overrides: Partial<Remedy>): Remedy {
  return {
    id: 'r-1',
    diseaseId: 'd-1',
    type: 'CULTURAL',
    titleBn: '[title]',
    stepsBn: ['[step one]'],
    sourceRef: '[source]',
    ...overrides,
  };
}

describe('FaqRemedyList — verbatim catalogue rendering (COMMON-CON-003)', () => {
  let fixture: ComponentFixture<FaqRemedyList>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FaqRemedyList],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideI18n()],
    }).compileComponents();
    fixture = TestBed.createComponent(FaqRemedyList);
  });

  async function render(remedies: readonly Remedy[]): Promise<HTMLElement> {
    fixture.componentRef.setInput('remedies', remedies);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('omits the dosage line entirely when the catalogue has no dose', async () => {
    const host = await render([remedy({ dosageBn: null })]);

    expect(host.querySelector('[data-testid="faq-remedy"]')).not.toBeNull();
    // Not a dash, not a zero, not "not specified" — absent.
    expect(host.querySelector('[data-testid="faq-remedy-dosage"]')).toBeNull();
  });

  it('shows the dose exactly as supplied when there is one', async () => {
    const host = await render([remedy({ type: 'ORGANIC', dosageBn: '[3 ml per litre]' })]);

    expect(host.querySelector('[data-testid="faq-remedy-dosage"]')?.textContent).toContain(
      '[3 ml per litre]',
    );
  });

  it('renders the steps in the order received, unchanged', async () => {
    const host = await render([
      remedy({ stepsBn: ['[first]', '[second]', '[third]'] }),
    ]);

    const steps = [...host.querySelectorAll('[data-testid="faq-remedy-steps"] li')].map((li) =>
      li.textContent?.trim(),
    );
    expect(steps).toEqual(['[first]', '[second]', '[third]']);
  });

  it('keeps chemical rows in their own section, with their PHI', async () => {
    const host = await render([
      remedy({ id: 'r-1', type: 'CULTURAL' }),
      remedy({ id: 'r-2', type: 'CHEMICAL', dosageBn: '[label rate]', phiDays: 21 }),
    ]);

    const chemical = host.querySelector('[data-testid="faq-chemical-section"]');
    const nonChemical = host.querySelector('[data-testid="faq-nonchemical-section"]');
    expect(chemical?.querySelectorAll('[data-testid="faq-remedy"]').length).toBe(1);
    expect(nonChemical?.querySelectorAll('[data-testid="faq-remedy"]').length).toBe(1);
    expect(chemical?.querySelector('[data-testid="faq-remedy-phi"]')?.textContent).toContain('21');
    expect(host.querySelector('[data-testid="faq-chemical-caution"]')).not.toBeNull();
  });

  it('says nothing about chemicals when the catalogue lists none', async () => {
    const host = await render([remedy({ type: 'BIOLOGICAL' })]);

    expect(host.querySelector('[data-testid="faq-chemical-section"]')).toBeNull();
    expect(host.querySelector('[data-testid="faq-chemical-caution"]')).toBeNull();
  });

  it('keeps all four catalogue types rather than collapsing them into two buckets', async () => {
    const host = await render([
      remedy({ id: 'a', type: 'CULTURAL' }),
      remedy({ id: 'b', type: 'ORGANIC' }),
      remedy({ id: 'c', type: 'BIOLOGICAL' }),
      remedy({ id: 'd', type: 'CHEMICAL' }),
    ]);

    expect(host.querySelectorAll('[data-testid="faq-remedy"]').length).toBe(4);
    // Every row still declares its own type, so nothing was silently re-labelled.
    expect(host.querySelectorAll('foshol-remedy-type-icon').length).toBe(4);
  });

  it('never renders a server string as markup (WEB-SEC-005)', async () => {
    const host = await render([remedy({ titleBn: '<img src=x onerror="x">' })]);

    expect(host.querySelector('img')).toBeNull();
    expect(host.textContent).toContain('<img src=x onerror="x">');
  });
});
