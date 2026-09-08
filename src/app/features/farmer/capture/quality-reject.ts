import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { APP_CONFIG } from '../../../core/config/app-config';
import { ConfidenceBar } from '../../../shared/ui/confidence-bar/confidence-bar';
import { QUALITY_BLURRY, QUALITY_TOO_LARGE, type QualityVerdict } from './quality-gate';

/**
 * Demo beat 3, on screen.
 *
 * WEB-FR-121/122/124 — the Bangla re-capture prompt, naming the reason.
 * WEB-FR-123 — it is rendered from a verdict computed locally, so it is visible before an
 * upload for this image has begun, let alone completed. There is no request behind this
 * component and `WEB-TEST-002` asserts the HTTP testing backend recorded zero of them.
 * WEB-FR-124 — the "send anyway" control exists for the vegetation heuristic and for nothing
 * else. The heuristic is weak, so it must never permanently block a farmer; blur and size get
 * no override because the server's gate would reject those anyway.
 *
 * The reticle is the signature: four corner brackets that snap inwards and settle clay-red
 * over the preview, the way a camera's focus box behaves when it fails to lock. For the blur
 * case the measured variance is drawn against the threshold on a miniature
 * `<foshol-confidence-bar>` — reusing the protected primitive ties this beat visually to the
 * officer console, and shows the farmer a number rather than an adjective.
 */

/**
 * The full-scale value of the miniature bar, as a multiple of the gate. Not a threshold, a
 * limit, an interval or a size (`WEB-NFR-009` governs those, and `app-config.ts` is frozen):
 * it is the top of a graphic's axis, chosen so the gate line lands at a quarter of the track
 * and an ordinary sharp photograph fills most of it.
 */
const BLUR_BAR_FULL_SCALE_MULTIPLE = 4;
const BAR_FLOOR = 0;
const BAR_CEILING = 1;

@Component({
  selector: 'foshol-quality-reject',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ConfidenceBar, TranslatePipe],
  host: { class: 'block' },
  template: `
    <section
      class="reject-card flex flex-col gap-4 md:flex-row md:items-start md:gap-5"
      data-testid="quality-reject"
      role="alert"
      [attr.aria-label]="'farmer.capture.quality.regionLabel' | translate"
    >
      <div class="reject-figure">
        <img
          class="reject-preview"
          [src]="previewUrl()"
          [alt]="'farmer.capture.quality.previewAlt' | translate"
        />
        <!-- A focus reticle that failed to lock: four brackets, settling, never bouncing. -->
        <span class="reticle" aria-hidden="true">
          <i class="corner tl"></i><i class="corner tr"></i>
          <i class="corner bl"></i><i class="corner br"></i>
        </span>
      </div>

      <div class="reject-body">
        <p class="reject-reason" data-testid="quality-reason">{{ reasonKey() | translate }}</p>
        <p class="reject-help">{{ helpKey() | translate }}</p>

        @if (showBlurBar()) {
          <div class="reject-metric">
            <p class="metric-label">{{ 'farmer.capture.quality.blurMetric' | translate }}</p>
            <foshol-confidence-bar
              [confidence]="blurFill()"
              [low]="blurLocalGate()"
              [high]="blurServerGate()"
              [compact]="true"
            />
          </div>
        }

        @if (outcome() === tooLarge) {
          <p class="reject-help" data-testid="quality-limit">
            {{ 'farmer.capture.quality.sizeLimit' | translate: { megabytes: limitMegabytes } }}
          </p>
        }

        @if (verdict().overridable) {
          <!-- The server's own gate now hard-rejects a photo with no crop in it (422
               NOT_A_CROP, nothing stored). The override still exists, because the local
               heuristic is weak and must never permanently block a farmer (WEB-FR-124) — but
               it stops being an invitation and says what is likely to happen. -->
          <p class="reject-warning" data-testid="quality-override-warning">
            {{ 'farmer.capture.quality.sendAnywayWarning' | translate }}
          </p>
        }

        <div class="reject-actions">
          <button
            type="button"
            class="retake touch-target"
            data-testid="quality-retake"
            (click)="dismissed.emit()"
          >
            {{ 'farmer.capture.quality.retake' | translate }}
          </button>

          @if (verdict().overridable) {
            <!-- WEB-FR-124 — the override, and only for the vegetation heuristic. -->
            <button
              type="button"
              class="override touch-target"
              data-testid="quality-override"
              (click)="overridden.emit()"
            >
              {{ 'farmer.capture.quality.sendAnyway' | translate }}
            </button>
          }
        </div>
      </div>
    </section>
  `,
  styles: `
    /* WEB-UX-034 — the responsive part is Tailwind's breakpoints in the template; no
       component stylesheet in this application writes a media query of its own. */
    .reject-card {
      padding: 1rem;
      border: 1px solid var(--color-clay-300);
      border-radius: 1.25rem;
      background: var(--color-clay-100);
      box-shadow: var(--shadow-card);
    }

    .reject-figure {
      position: relative;
      flex: none;
      inline-size: 100%;
      aspect-ratio: 1;
      max-inline-size: 12rem;
      overflow: hidden;
      border-radius: 1rem;
      background: var(--color-surface-2);
    }

    .reject-preview {
      inline-size: 100%;
      block-size: 100%;
      object-fit: cover;
      /* Desaturated so the reticle, not the photograph, is what the eye lands on. */
      filter: saturate(0.55) contrast(0.95);
    }

    .reticle {
      position: absolute;
      inset: 0;
    }

    .corner {
      position: absolute;
      inline-size: 26%;
      block-size: 26%;
      border: 3px solid var(--color-clay-600);
      animation: reticle-snap var(--duration-3) var(--ease-settle) both;
    }

    .tl {
      inset-block-start: 8%;
      inset-inline-start: 8%;
      border-inline-end: 0;
      border-block-end: 0;
      border-start-start-radius: 0.4rem;
    }
    .tr {
      inset-block-start: 8%;
      inset-inline-end: 8%;
      border-inline-start: 0;
      border-block-end: 0;
      border-start-end-radius: 0.4rem;
    }
    .bl {
      inset-block-end: 8%;
      inset-inline-start: 8%;
      border-inline-end: 0;
      border-block-start: 0;
      border-end-start-radius: 0.4rem;
    }
    .br {
      inset-block-end: 8%;
      inset-inline-end: 8%;
      border-inline-start: 0;
      border-block-start: 0;
      border-end-end-radius: 0.4rem;
    }

    @keyframes reticle-snap {
      from {
        opacity: 0;
        transform: scale(1.35);
      }
      to {
        opacity: 1;
        transform: scale(1);
      }
    }

    .reject-body {
      min-inline-size: 0;
      flex: 1;
    }

    .reject-reason {
      font-size: 1.0625rem;
      font-weight: 700;
      color: var(--color-clay-700);
    }

    .reject-help {
      margin-block-start: 0.35rem;
      font-size: 0.9375rem;
      color: var(--color-ink);
    }

    .reject-warning {
      margin-block-start: 0.85rem;
      padding: 0.55rem 0.75rem;
      border-inline-start: 3px solid var(--color-dawn-600);
      border-radius: 0.3rem;
      background: var(--color-dawn-100);
      font-size: 0.875rem;
      font-weight: 600;
      color: var(--color-dawn-700);
    }

    .reject-metric {
      margin-block-start: 0.85rem;
      padding: 0.65rem 0.8rem;
      border-radius: 0.85rem;
      background: var(--color-surface-0);
      border: 1px solid var(--color-surface-3);
    }

    .metric-label {
      margin-block-end: 0.35rem;
      font-size: 0.8125rem;
      font-weight: 600;
      color: var(--color-ink-muted);
    }

    .reject-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.6rem;
      margin-block-start: 1rem;
    }

    .retake,
    .override {
      padding-inline: 1.1rem;
      border-radius: 0.9rem;
      font-weight: 700;
    }

    .retake {
      background: var(--color-clay-600);
      color: var(--color-ink-invert);
      box-shadow: var(--shadow-stamp);
    }

    .retake:hover {
      background: var(--color-clay-700);
    }

    .override {
      background: var(--color-surface-0);
      color: var(--color-ink);
      border: 1px solid var(--color-surface-3);
    }

    .override:hover {
      border-color: var(--color-ink-faint);
    }
  `,
})
export class QualityReject {
  readonly previewUrl = input.required<string>();
  readonly verdict = input.required<QualityVerdict>();

  /** Retake: drop this photograph entirely. */
  readonly dismissed = output<void>();
  /** WEB-FR-124 — send it despite the vegetation heuristic. */
  readonly overridden = output<void>();

  protected readonly tooLarge = QUALITY_TOO_LARGE;
  protected readonly limitMegabytes = APP_CONFIG.intake.maxImageBytes / BYTES_PER_MEGABYTE;

  protected readonly outcome = computed(() => this.verdict().outcome);
  protected readonly reasonKey = computed(() => `farmer.capture.quality.reason.${this.outcome()}`);
  protected readonly helpKey = computed(() => `farmer.capture.quality.help.${this.outcome()}`);
  protected readonly showBlurBar = computed(() => this.outcome() === QUALITY_BLURRY);

  private readonly fullScale = computed(
    () => this.verdict().measurements.blurThreshold * BLUR_BAR_FULL_SCALE_MULTIPLE,
  );

  protected readonly blurFill = computed(() =>
    proportion(this.verdict().measurements.blurVariance, this.fullScale()),
  );
  /** The line this screen judged against. */
  protected readonly blurLocalGate = computed(() =>
    proportion(this.verdict().measurements.blurThreshold, this.fullScale()),
  );
  /**
   * WEB-FR-125 — and the line the server will judge against, which is the decision of record.
   * They coincide while `capture.blurVarianceClientMargin` is 1.0, and that agreement is
   * itself the point: the local gate is tuned never to reject what the server would accept.
   */
  protected readonly blurServerGate = computed(() =>
    proportion(this.verdict().measurements.serverBlurThreshold, this.fullScale()),
  );
}

function proportion(value: number, fullScale: number): number {
  if (!(fullScale > BAR_FLOOR)) return BAR_FLOOR;
  return Math.min(BAR_CEILING, Math.max(BAR_FLOOR, value / fullScale));
}

const BYTES_PER_MEGABYTE = 1024 * 1024;
