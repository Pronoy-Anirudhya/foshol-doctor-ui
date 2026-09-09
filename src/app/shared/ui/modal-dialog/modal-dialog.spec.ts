import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';
import sharedFragment from '../../../../i18n/shared.i18n.json';
import { APP_CONFIG } from '../../../core/config/app-config';
import { provideI18n } from '../../../core/i18n/i18n.providers';
import { ModalDialog } from './modal-dialog';

@Component({
  imports: [ModalDialog],
  template: `
    <button type="button" data-testid="opener" (click)="open.set(true)">open</button>
    <foshol-modal-dialog
      [open]="open()"
      titleKey="shared.modal.close"
      headingId="test-title"
      (closed)="onClosed()"
    >
      <p data-testid="projected">body</p>
    </foshol-modal-dialog>
  `,
})
class Host {
  readonly open = signal(false);
  closedCount = 0;
  onClosed(): void {
    this.closedCount += 1;
    this.open.set(false);
  }
}

describe('ModalDialog', () => {
  let fixture: ComponentFixture<Host>;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideI18n()] });
    TestBed.inject(TranslateService).setTranslation(
      APP_CONFIG.i18n.defaultLocale,
      Object.fromEntries(Object.entries(sharedFragment).map(([key, value]) => [key, value.bn])),
      true,
    );
    fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
  });

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function dialog(): HTMLDialogElement {
    return el().querySelector('dialog')!;
  }

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  it('keeps its content out of the DOM while shut, so a form inside starts fresh each time', async () => {
    expect(dialog().open).toBe(false);
    expect(el().querySelector('[data-testid="projected"]')).toBeNull();
  });

  it('opens when the owner says so, and projects the caller’s content', async () => {
    fixture.componentInstance.open.set(true);
    await settle();

    expect(dialog().open).toBe(true);
    expect(el().querySelector('[data-testid="projected"]')).not.toBeNull();
  });

  it('names itself with its own heading, so assistive tech announces what opened', async () => {
    fixture.componentInstance.open.set(true);
    await settle();

    expect(dialog().getAttribute('aria-labelledby')).toBe('test-title');
    expect(el().querySelector('#test-title')).not.toBeNull();
  });

  it('emits closed exactly once when the close button is used', async () => {
    fixture.componentInstance.open.set(true);
    await settle();

    el().querySelector<HTMLElement>('[data-testid="modal-close"]')!.click();
    await settle();

    expect(fixture.componentInstance.closedCount).toBe(1);
    expect(dialog().open).toBe(false);
  });

  it('emits closed for a native close too — Escape and the button share one path', async () => {
    fixture.componentInstance.open.set(true);
    await settle();

    // What `Escape` does: the element closes itself and fires `close`. Dispatching the event is
    // how that reaches the component in jsdom, which has no key handling for `<dialog>`.
    dialog().dispatchEvent(new Event('close'));
    await settle();

    expect(fixture.componentInstance.closedCount).toBe(1);
  });

  it('does not emit a second closed when the owner then lowers `open`', async () => {
    fixture.componentInstance.open.set(true);
    await settle();

    el().querySelector<HTMLElement>('[data-testid="modal-close"]')!.click();
    await settle();
    fixture.componentInstance.open.set(false);
    await settle();

    expect(fixture.componentInstance.closedCount).toBe(1);
  });
});
