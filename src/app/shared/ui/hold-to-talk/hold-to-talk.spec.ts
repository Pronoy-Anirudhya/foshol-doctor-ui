import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { BN_CATALOGUE } from '../../../core/i18n/bn-catalogue';
import { provideI18n } from '../../../core/i18n/i18n.providers';
import { HoldToTalk } from './hold-to-talk';

/**
 * The convention, asserted as a component rather than trusted as a habit (`DEVIATIONS.md` D-33).
 *
 * The load-bearing case is the one that looks redundant: **a plain click must do nothing.** The
 * land-step mic was a tap-to-toggle for months; if this component ever grows a click handler,
 * every voice control in the application silently reverts to a tap, and this is the test that
 * would notice.
 *
 * jsdom has no `PointerEvent` and no `setPointerCapture` — the directive guards for the latter
 * and plain `Event`s carry the former, which is the approach `pointer-hold.directive.spec.ts`
 * already takes.
 */
describe('HoldToTalk — press-and-hold is the only way to open a microphone', () => {
  let fixture: ComponentFixture<HoldToTalk>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HoldToTalk],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideI18n()],
    }).compileComponents();
    fixture = TestBed.createComponent(HoldToTalk);
    fixture.componentRef.setInput('labelKey', 'farmer.capture.voice.holdLabel');
  });

  afterEach(() => TestBed.resetTestingModule());

  async function render(
    inputs: Partial<Record<string, unknown>> = {},
  ): Promise<{ button: HTMLButtonElement; starts: number[]; ends: number[] }> {
    for (const [name, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(name, value);
    }
    const starts: number[] = [];
    const ends: number[] = [];
    fixture.componentInstance.holdStart.subscribe(() => starts.push(1));
    fixture.componentInstance.holdEnd.subscribe(() => ends.push(1));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const button = (fixture.nativeElement as HTMLElement).querySelector('button');
    if (button === null) throw new Error('no button rendered');
    return { button, starts, ends };
  }

  const press = (button: Element): boolean =>
    button.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  const lift = (button: Element): boolean =>
    button.dispatchEvent(new Event('pointerup', { bubbles: true }));

  it('emits on press and on release', async () => {
    const { button, starts, ends } = await render();

    press(button);
    expect(starts.length).toBe(1);
    expect(ends.length).toBe(0);

    lift(button);
    expect(ends.length).toBe(1);
  });

  it('does nothing at all on a plain click — the whole point of the convention', async () => {
    const { button, starts, ends } = await render();

    button.click();

    expect(starts.length).toBe(0);
    expect(ends.length).toBe(0);
  });

  it('carries the held state for a screen reader, not only in colour (WEB-UX-044)', async () => {
    const { button } = await render({ active: false });
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(button.getAttribute('data-active')).toBeNull();

    fixture.componentRef.setInput('active', true);
    fixture.detectChanges();
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.getAttribute('data-active')).toBe('true');
  });

  it('always has an accessible name, resolved from the required label key (WEB-UX-042)', async () => {
    const { button } = await render();

    expect(button.getAttribute('aria-label')).toBe(
      BN_CATALOGUE['farmer.capture.voice.holdLabel'],
    );
  });

  it('is a 64px thumb target rather than the 44px floor (WEB-UX-021)', async () => {
    const { button } = await render();

    expect(button.classList.contains('touch-target-lg')).toBe(true);
  });

  it('announces work in progress without inventing a second visual state', async () => {
    const { button } = await render({ busy: true });

    expect(button.getAttribute('aria-busy')).toBe('true');
  });

  it('refuses the gesture while disabled, and says so', async () => {
    const { button, starts } = await render({ holdDisabled: true });

    press(button);

    expect(starts.length).toBe(0);
    expect(button.getAttribute('aria-disabled')).toBe('true');
  });

  it('keeps the consumer’s own test hook so adopting it breaks no existing spec', async () => {
    const { button } = await render({ testId: 'record-button' });

    expect(button.getAttribute('data-testid')).toBe('record-button');
  });
});
