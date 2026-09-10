import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

/**
 * The `(bn)` marker: "English was asked for, and this text is Bangla because no English
 * translation exists" (`WEB-UX-015`, `COMMON-NFR-038`).
 *
 * Its own component because two kinds of caller need it — a single field through
 * `<foshol-bn-value>`, and a whole list of steps, where one flag covers the array and a marker
 * per line would be noise. The caller decides *whether* to render it; this only decides what it
 * looks like and what a screen reader is told.
 *
 * `WEB-UX-044` — the marker is text in its own element. Colour carries none of the meaning.
 */
let markerSequence = 0;

@Component({
  selector: 'foshol-bn-marker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  host: { class: 'inline' },
  template: `
    <span
      class="ms-1 rounded border border-surface-3 bg-surface-2 px-1 align-baseline font-latin text-[0.75em] font-medium text-ink-muted"
      data-testid="bn-marker"
      [attr.aria-describedby]="descriptionId"
      >{{ 'shared.bnFallback.marker' | translate }}</span
    >
    <span [id]="descriptionId" class="sr-only">{{
      'shared.bnFallback.description' | translate
    }}</span>
  `,
})
export class BnMarker {
  protected readonly descriptionId = `bn-fallback-${(markerSequence += 1)}`;
}
