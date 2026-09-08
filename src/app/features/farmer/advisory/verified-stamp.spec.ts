import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { describe, expect, it } from 'vitest';
import { VerifiedStamp } from './verified-stamp';

/**
 * Regression guard for a bug that made the whole advisory card unreadable.
 *
 * The stamp sets its class through `host: { class: 'vs-host' }`, and the stylesheet originally
 * targeted `.vs-host`. Under emulated view encapsulation Angular rewrites a bare class selector
 * to `.vs-host[_ngcontent-x]`, but a host element carries `_nghost-x` — so the rule matched
 * nothing and every declaration in it was dropped, including `position: relative`. The rosette
 * inside is `position: absolute; inset: 0`, so with no positioned ancestor it sized itself
 * against the viewport and covered the entire advisory.
 *
 * Nothing in the DOM was missing, which is why it survived a unit suite and a type-check: the
 * defect was purely in which selector the styles used. This test asserts that directly.
 */
describe('VerifiedStamp — host styling (regression)', () => {
  const stylesOf = (): string => {
    const def = (VerifiedStamp as unknown as { ɵcmp: { styles?: string[] } }).ɵcmp;
    return (def.styles ?? []).join('\n');
  };

  it('styles the host through :host, never a bare .vs-host selector', () => {
    const css = stylesOf();
    // Angular compiles `:host` to `[_nghost-%COMP%]`; that is what proves the rule targets the
    // host element rather than its content.
    expect(css).toContain('[_nghost-%COMP%]');
    // A bare `.vs-host {` rule compiles to `.vs-host[_ngcontent-%COMP%]` and matches nothing.
    expect(css).not.toMatch(/\.vs-host\[_ngcontent/);
  });

  it('gives the absolutely-positioned rosette a positioned, sized ancestor', () => {
    const css = stylesOf().replace(/\s+/g, ' ');
    const host = css.match(/\[_nghost-%COMP%\]\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(host).toMatch(/position:\s*relative/);
    // Without an explicit size the rosette has nothing to fill.
    expect(host).toMatch(/inline-size:|block-size:|width:|height:/);
    expect(css).toMatch(/\.vs-rosette\[_ngcontent-%COMP%\]\s*\{[^}]*position:\s*absolute/);
  });

  it('renders the officer name verbatim, never translated (WEB-UX-016)', async () => {
    await TestBed.configureTestingModule({
      imports: [VerifiedStamp],
      providers: [provideTranslateService({ lang: 'bn', fallbackLang: 'bn' })],
    }).compileComponents();

    const fixture = TestBed.createComponent(VerifiedStamp);
    fixture.componentRef.setInput('officerName', 'Demo Officer');
    fixture.componentRef.setInput('publishedAt', '2026-09-07T20:36:00Z');
    await fixture.whenStable();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="verified-officer-name"]')?.textContent?.trim()).toBe(
      'Demo Officer',
    );
  });
});
