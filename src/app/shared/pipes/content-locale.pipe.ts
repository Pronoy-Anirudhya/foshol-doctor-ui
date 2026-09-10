import { inject, Pipe, type PipeTransform } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import type { Locale } from '../../core/config/app-config';
import { appendMarker, pickContent } from './content-locale';

/**
 * A bilingual catalogue field as plain text, for a context where a marker element cannot exist
 * — an `<option>`, an `alt`, an `aria-label`, a `title`.
 *
 * Everywhere the marker CAN have its own element, use `<foshol-bn-value>` instead: it carries
 * the accessible description as well, which a bare string cannot.
 *
 * `locale` is an argument rather than an injected read so the pipe stays PURE. Angular
 * re-evaluates it when the toggle changes the locale, which is what makes `WEB-UX-012` hold
 * with no reload and no refetch — both locales are already on the object.
 */
const MARKER_KEY = 'shared.bnFallback.marker';

@Pipe({ name: 'contentText' })
export class ContentTextPipe implements PipeTransform {
  private readonly translate = inject(TranslateService);

  transform(
    bn: string | null | undefined,
    en: string | null | undefined,
    fallback: boolean | null | undefined,
    locale: Locale,
  ): string {
    const view = pickContent(bn, en, fallback, locale);
    return appendMarker(view.text, view.marked, this.translate.instant(MARKER_KEY));
  }
}
