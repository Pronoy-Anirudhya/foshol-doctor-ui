import {
  afterNextRender,
  booleanAttribute,
  Directive,
  ElementRef,
  inject,
  input,
} from '@angular/core';

/**
 * Moves focus to the host once it is in the DOM — the OTP box after the code is requested,
 * the reason field when the reject dialogue opens.
 *
 * WEB-UX-040 / WEB-UX-041 — focus is *moved*, never trapped, and the global `:focus-visible`
 * rule keeps it visible. A disabled control is skipped: focusing one is a no-op in some
 * browsers and steals focus from the page in others, and either way it is not where the user
 * should be.
 *
 * `afterNextRender` rather than `ngAfterViewInit` because the application is zoneless: the
 * host may still be inside a template that has not been committed to the DOM when the
 * lifecycle hook runs.
 */
@Directive({ selector: '[fosholAutofocus]' })
export class AutofocusDirective {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** `[fosholAutofocus]="false"` opts a control out without removing the directive. */
  readonly enabled = input(true, { alias: 'fosholAutofocus', transform: booleanAttribute });

  constructor() {
    afterNextRender(() => {
      const element = this.host.nativeElement;
      if (!this.enabled()) return;
      const maybeDisableable = element as HTMLElement & { disabled?: unknown };
      const disabled =
        maybeDisableable.disabled === true || element.getAttribute('aria-disabled') === 'true';
      if (disabled) return;
      element.focus();
    });
  }
}
