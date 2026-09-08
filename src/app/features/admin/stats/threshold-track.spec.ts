import { TestBed } from '@angular/core/testing';
import { provideI18n } from '../../../core/i18n/i18n.providers';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ThresholdTrack } from './threshold-track';

describe('ThresholdTrack (WEB-FR-302, WEB-UX-044)', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideI18n()],
    });
  });

  async function render(low: number, high: number): Promise<HTMLElement> {
    const fixture = TestBed.createComponent(ThresholdTrack);
    fixture.componentRef.setInput('low', low);
    fixture.componentRef.setInput('high', high);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('draws a line for each threshold at its exact proportional position', async () => {
    const host = await render(0.45, 0.75);

    // The boundary case percent.ts exists for: 0.45 * 100 is not 45 in IEEE-754.
    expect(host.style.getPropertyValue('--tt-low')).toBe('45%');
    expect(host.style.getPropertyValue('--tt-high')).toBe('75%');
    expect(host.querySelectorAll('[data-testid="tt-line"]').length).toBe(2);
  });

  it('states both values as text, so the track is never read by position alone', async () => {
    const host = await render(0.4, 0.8);

    const labels = [...host.querySelectorAll('[data-testid="tt-line-label"]')].map((l) =>
      l.textContent?.trim(),
    );
    expect(labels).toEqual(['40%', '80%']);
    expect(host.querySelector('[data-testid="threshold-low"]')?.textContent?.trim()).toBe('40%');
    expect(host.querySelector('[data-testid="threshold-high"]')?.textContent?.trim()).toBe('80%');
  });

  it('tiles the scale with the three bands, each named in text', async () => {
    const host = await render(0.45, 0.75);

    const widths = [...host.querySelectorAll<HTMLElement>('.tt-band')].map((b) => b.style.width);
    expect(widths).toEqual(['45%', '30%', '25%']);

    const named = [...host.querySelectorAll('foshol-decision-path-badge')].map((b) =>
      b.getAttribute('data-path'),
    );
    expect(named).toEqual(['UNDETERMINED', 'SECONDARY', 'PRIMARY']);
    for (const card of host.querySelectorAll('.tt-band-range')) {
      expect(card.textContent?.trim().length).toBeGreaterThan(0);
    }
  });

  it('exposes both values in one label for a screen reader', async () => {
    const host = await render(0.45, 0.75);
    const label = host.querySelector('[role="img"]')?.getAttribute('aria-label') ?? '';

    expect(label).toContain('45%');
    expect(label).toContain('75%');
  });
});
