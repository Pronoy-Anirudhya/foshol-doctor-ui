import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PointerHoldDirective } from './pointer-hold.directive';

@Component({
  imports: [PointerHoldDirective],
  template: `
    <button
      type="button"
      fosholPointerHold
      [fosholPointerHoldDisabled]="disabled()"
      (holdStart)="starts.set(starts() + 1)"
      (holdEnd)="ends.set(ends() + 1)"
    >
      hold
    </button>
  `,
})
class HoldHost {
  readonly disabled = signal(false);
  readonly starts = signal(0);
  readonly ends = signal(0);
}

/**
 * WEB-FR-143 / WEB-FR-144 — the release paths are the whole point. Touch on a phone is
 * interrupted routinely, and a recorder that never receives the release runs to the
 * max-audio-seconds cap holding the microphone open.
 */
describe('PointerHoldDirective (WEB-FR-143, WEB-FR-144, WEB-UX-040)', () => {
  async function render() {
    const fixture = TestBed.createComponent(HoldHost);
    await fixture.whenStable();
    const button = (fixture.nativeElement as HTMLElement).querySelector('button');
    if (button === null) throw new Error('host button missing');
    return { fixture, button, host: fixture.componentInstance };
  }

  const press = (button: Element) =>
    button.dispatchEvent(new Event('pointerdown', { bubbles: true }));

  it('starts on pointerdown and ends on pointerup', async () => {
    const { button, host } = await render();
    press(button);
    expect(host.starts()).toBe(1);
    expect(host.ends()).toBe(0);

    button.dispatchEvent(new Event('pointerup', { bubbles: true }));
    expect(host.ends()).toBe(1);
  });

  for (const release of ['pointercancel', 'pointerleave', 'lostpointercapture', 'blur']) {
    it(`treats ${release} as a release, keeping what was captured`, async () => {
      const { button, host } = await render();
      press(button);
      button.dispatchEvent(new Event(release, { bubbles: true }));
      expect(host.ends()).toBe(1);
    });
  }

  it('ends the hold when the page is hidden (WEB-FR-144)', async () => {
    const { button, host } = await render();
    press(button);
    expect(host.ends()).toBe(0);

    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    try {
      document.dispatchEvent(new Event('visibilitychange'));
    } finally {
      // Remove the own property so the prototype getter takes over again.
      Reflect.deleteProperty(document, 'visibilityState');
    }

    // An incoming call or a backgrounded tab suspends media capture on both platforms; the
    // hold must end with it so the microphone track is released.
    expect(host.ends()).toBe(1);
  });

  it('is idempotent — several release paths for one gesture emit holdEnd once', async () => {
    const { button, host } = await render();
    press(button);
    button.dispatchEvent(new Event('pointerup', { bubbles: true }));
    button.dispatchEvent(new Event('pointercancel', { bubbles: true }));
    button.dispatchEvent(new Event('pointerleave', { bubbles: true }));
    expect(host.ends()).toBe(1);
  });

  it('is operable by keyboard, and a key repeat does not restart the hold (WEB-UX-040)', async () => {
    const { button, host } = await render();
    button.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    button.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', repeat: true, bubbles: true }));
    expect(host.starts()).toBe(1);

    button.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true }));
    expect(host.ends()).toBe(1);
  });

  it('ignores a gesture while disabled', async () => {
    const { fixture, button, host } = await render();
    host.disabled.set(true);
    await fixture.whenStable();

    press(button);
    button.dispatchEvent(new Event('pointerup', { bubbles: true }));
    expect(host.starts()).toBe(0);
    expect(host.ends()).toBe(0);
  });
});
