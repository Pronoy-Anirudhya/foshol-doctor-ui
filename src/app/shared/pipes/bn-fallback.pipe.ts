import { inject, Pipe, type PipeTransform } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import type { Locale } from '../../core/config/app-config';

/**
 * WEB-UX-015 — a content field whose sibling `<field>Fallback` flag is `true`
 * (`COMMON-NFR-038`) is Bangla text sitting in an English-named field, because no English
 * translation exists. It renders with a visible `(bn)` **text** marker; WEB-UX-044 forbids
 * carrying that meaning in colour alone.
 *
 * WEB-UX-016 — the value itself is never translated. It is passed through verbatim.
 *
 * This is the plain-text form, for an `alt`, an `aria-label` or a `title` where a marker
 * element cannot exist. Where the marker can have its own element — which is everywhere
 * visible — use `<foshol-bn-value>`, which also carries the accessible description.
 *
 * `locale` is an argument rather than an injected read so the pipe stays PURE: Angular
 * re-evaluates it when the toggle changes the locale, which is what makes WEB-UX-012 hold
 * without a reload.
 */
const MARKER_KEY = 'shared.bnFallback.marker';
const BANGLA: Locale = 'bn';

@Pipe({ name: 'bnFallback' })
export class BnFallbackPipe implements PipeTransform {
  private readonly translate = inject(TranslateService);

  transform(
    value: string | null | undefined,
    fallback: boolean | null | undefined,
    locale: Locale,
  ): string {
    const text = value ?? '';
    // In Bangla the value is already the language of record, so the marker says nothing.
    if (text.length === 0 || fallback !== true || locale === BANGLA) return text;
    const marker: unknown = this.translate.instant(MARKER_KEY);
    return typeof marker === 'string' && marker.length > 0 ? `${text} ${marker}` : text;
  }
}
