import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { LanguageStore } from '../../../core/i18n/language-store';
import { pickContent } from '../../pipes/content-locale';
import { BnMarker } from './bn-marker';

/**
 * One bilingual catalogue field, rendered in the active locale, with the `(bn)` fallback marker
 * when English was asked for and there is none.
 *
 * The component takes the **pair** rather than a pre-picked string, so that choosing between
 * `nameBn` and `nameEn` happens in exactly one place instead of an `if (lang === 'en')` in every
 * component. Both values are already on the object the server sent, so the toggle re-reads a
 * signal — it never refetches (`WEB-UX-012`).
 *
 * `WEB-UX-016` / `COMMON-CON-003` — the value is NEVER translated, rewritten or reformatted. It
 * is interpolated as text (`WEB-SEC-005`) exactly as the server returned it, digits included.
 *
 * Usage: `<foshol-bn-value [bn]="crop.nameBn" [en]="crop.nameEn" [fallback]="crop.nameEnFallback" />`
 */
@Component({
  selector: 'foshol-bn-value',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BnMarker],
  host: { class: 'inline' },
  template: `
    <span>{{ view().text }}</span>
    @if (view().marked) {
      <foshol-bn-marker />
    }
  `,
})
export class BnValue {
  private readonly language = inject(LanguageStore);

  /**
   * The Bangla field — the language of record (`COMMON-NFR-037`). Nullable, because plenty of
   * catalogue fields are optional on the contract (`topDiseaseNameBn`, `diseaseNameBn`); an
   * absent one renders as nothing rather than forcing every caller to spell `?? ''`.
   */
  readonly bn = input<string | null | undefined>('');
  /** The English field, or the Bangla copy the server made when it had no English. */
  readonly en = input<string | null | undefined>(null);
  /** The server's `*EnFallback` flag: true means `en` is Bangla text. */
  readonly fallback = input<boolean | null | undefined>(false);

  protected readonly view = computed(() =>
    pickContent(this.bn(), this.en(), this.fallback(), this.language.current()),
  );
}
