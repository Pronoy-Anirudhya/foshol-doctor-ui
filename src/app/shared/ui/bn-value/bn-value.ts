import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { APP_CONFIG } from '../../../core/config/app-config';
import { LanguageStore } from '../../../core/i18n/language-store';

/**
 * Renders one server-supplied content field, with the `(bn)` fallback marker when there is no
 * English translation for it.
 *
 * WEB-UX-015 — a content field arriving with its sibling `<field>Fallback` flag `true`
 * (`COMMON-NFR-038`) is Bangla text in an English-named field. It renders with a visible
 * `(bn)` **text** marker beside it and an accessible description saying no English
 * translation exists.
 *
 * WEB-UX-044 — the marker is text, in its own element. Colour carries none of the meaning,
 * which is exactly why this is a component and not a CSS class.
 *
 * WEB-UX-016 / COMMON-CON-003 — the value itself is NEVER translated and never rewritten. It
 * is interpolated as text (WEB-SEC-005) exactly as the server returned it.
 *
 * Usage: `<foshol-bn-value [value]="crop.nameEn" [fallback]="crop.nameEnFallback" />`
 */
let markerSequence = 0;

@Component({
  selector: 'foshol-bn-value',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  host: { class: 'inline' },
  template: `
    <span>{{ value() }}</span>
    @if (marked()) {
      <span
        class="ms-1 rounded border border-surface-3 bg-surface-2 px-1 align-baseline text-[0.75em] font-medium text-ink-muted font-latin"
        [attr.aria-describedby]="descriptionId"
        >{{ 'shared.bnFallback.marker' | translate }}</span
      >
      <span [id]="descriptionId" class="sr-only">{{
        'shared.bnFallback.description' | translate
      }}</span>
    }
  `,
})
export class BnValue {
  private readonly language = inject(LanguageStore);

  readonly value = input('');
  readonly fallback = input(false);

  /**
   * In Bangla the value is already the language of record (COMMON-NFR-037), so a marker
   * saying "this is Bangla" would be noise. The flag only means something while English is
   * being asked for.
   */
  protected readonly marked = computed(
    () =>
      this.fallback() &&
      this.value().length > 0 &&
      this.language.current() !== APP_CONFIG.i18n.defaultLocale,
  );

  protected readonly descriptionId = `bn-fallback-${(markerSequence += 1)}`;
}
