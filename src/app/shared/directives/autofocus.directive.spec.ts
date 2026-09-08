import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AutofocusDirective } from './autofocus.directive';

@Component({
  imports: [AutofocusDirective],
  template: ` <input id="target" [fosholAutofocus]="enabled()" [disabled]="disabled()" /> `,
})
class FocusHost {
  readonly enabled = signal(true);
  readonly disabled = signal(false);
}

describe('AutofocusDirective (WEB-UX-040)', () => {
  async function render(configure: (host: FocusHost) => void = () => undefined) {
    const fixture = TestBed.createComponent(FocusHost);
    configure(fixture.componentInstance);
    await fixture.whenStable();
    return document.activeElement;
  }

  it('moves focus to the host once it is in the DOM', async () => {
    expect((await render())?.id).toBe('target');
  });

  it('leaves focus alone when opted out', async () => {
    expect((await render((host) => host.enabled.set(false)))?.id).not.toBe('target');
  });

  it('never focuses a disabled control', async () => {
    expect((await render((host) => host.disabled.set(true)))?.id).not.toBe('target');
  });
});
