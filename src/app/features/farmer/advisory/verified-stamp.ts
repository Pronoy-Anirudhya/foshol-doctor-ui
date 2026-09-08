import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { DhakaDateTimePipe } from '../../../shared/pipes/dhaka-date-time.pipe';

/**
 * `WEB-FR-155` — the visible "verified by {officerName}" stamp.
 *
 * This is the one piece of chrome the whole product exists to justify: *no farmer in this
 * system has ever received unverified pesticide advice*. That claim belongs on the farmer's
 * screen, beside the advice, not in a slide. So it is drawn as an ink stamp rather than as a
 * badge — a badge reads as UI decoration, a stamp reads as a person having signed something.
 *
 * How the ink look is made, since it is not obvious from the markup:
 *  - the rosette is inline SVG (no icon pack — `WEB-NFR-007`), aria-hidden, because the text
 *    on top of it already says everything a screen reader needs;
 *  - the deckle edge is a `repeating-conic-gradient` mask unioned with a solid radial core, so
 *    the rim is notched by the wedges while the middle stays fully opaque;
 *  - `drop-shadow` rather than `box-shadow`, because the shadow has to follow the notched
 *    silhouette rather than a rectangle;
 *  - a −7° rotation, so it sits like something pressed by hand.
 *
 * `WEB-UX-016` / `COMMON-CON-003` — `officerName` is a server-supplied value. It is
 * interpolated as text, never translated, never reformatted.
 */
@Component({
  selector: 'foshol-verified-stamp',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, DhakaDateTimePipe],
  host: { class: 'vs-host', 'data-testid': 'verified-stamp' },
  template: `
    <svg class="vs-rosette" viewBox="0 0 200 200" aria-hidden="true" fill="none">
      <circle cx="100" cy="100" r="94" fill="currentColor" fill-opacity="0.07" />
      <circle cx="100" cy="100" r="90" stroke="currentColor" stroke-width="7" />
      <circle
        cx="100"
        cy="100"
        r="79"
        stroke="currentColor"
        stroke-width="3"
        stroke-dasharray="3 9"
        stroke-linecap="round"
      />
      <circle cx="100" cy="100" r="70" stroke="currentColor" stroke-width="2" />
      <!-- A leaf, so the mark reads as agricultural before it reads as bureaucratic. -->
      <path
        d="M100 36c-11 8-17 17-17 26 0 7 4 12 9 15v9h16v-9c5-3 9-8 9-15 0-9-6-18-17-26Z"
        fill="currentColor"
        fill-opacity="0.22"
      />
      <path d="M100 48v37" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
    </svg>

    <div class="vs-text">
      <p class="vs-eyebrow">{{ 'farmer.advisory.verifiedEyebrow' | translate }}</p>
      <!-- Server-supplied, rendered verbatim (WEB-UX-016). -->
      <p class="vs-name" data-testid="verified-officer-name">{{ officerName() }}</p>
      <p class="vs-date">
        <!-- WEB-DATA-006 — every instant the farmer sees is Asia/Dhaka. -->
        {{ publishedAt() | dhakaDateTime }}
      </p>
    </div>
  `,
  styles: `
    /* Must be :host, not .vs-host. The class is set on the host element, but emulated
       encapsulation rewrites a bare class selector to .vs-host[_ngcontent-x] while a host
       carries _nghost-x — so the rule never matched and every declaration below was silently
       dropped. The rosette then had no positioned ancestor and sized itself against the
       viewport, covering the entire advisory card. */
    :host {
      position: relative;
      display: grid;
      place-items: center;
      inline-size: 11.5rem;
      block-size: 11.5rem;
      flex: none;
      rotate: -7deg;
      color: var(--color-paddy-700);
      /* Follows the notched silhouette, which box-shadow cannot. */
      filter: drop-shadow(0 1px 0 rgb(20 33 27 / 0.22)) drop-shadow(0 8px 16px rgb(20 33 27 / 0.16));
    }

    .vs-rosette {
      position: absolute;
      inset: 0;
      inline-size: 100%;
      block-size: 100%;
      /* The deckle edge: an opaque core, with the rim eaten into by repeating wedges. The
         two layers union (mask-composite: add), so only the rim is notched. */
      mask-image:
        repeating-conic-gradient(from 0deg, #000 0deg 5.2deg, transparent 5.2deg 7.5deg),
        radial-gradient(circle at 50% 50%, #000 0 82%, transparent 82%);
      mask-composite: add;
    }

    .vs-text {
      position: relative;
      z-index: 1;
      max-inline-size: 8.5rem;
      padding-block-start: 2.1rem;
      text-align: center;
      overflow-wrap: anywhere;
    }

    .vs-eyebrow {
      margin: 0;
      font-size: 0.7rem;
      font-weight: 700;
      line-height: 1.3;
      text-transform: uppercase;
      color: var(--color-paddy-700);
    }

    .vs-name {
      margin: 0.15rem 0 0;
      font-size: 0.95rem;
      font-weight: 800;
      line-height: 1.25;
      color: var(--color-paddy-800);
    }

    .vs-date {
      margin: 0.25rem 0 0;
      font-size: 0.66rem;
      font-weight: 600;
      line-height: 1.35;
      color: var(--color-paddy-700);
      font-variant-numeric: tabular-nums;
    }
  `,
})
export class VerifiedStamp {
  readonly officerName = input.required<string>();
  readonly publishedAt = input.required<string>();
}
