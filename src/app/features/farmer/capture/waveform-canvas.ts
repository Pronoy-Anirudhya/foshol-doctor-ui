import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  viewChild,
} from '@angular/core';

/**
 * WEB-FR-132 — the live waveform, driven by an `AnalyserNode` and drawn straight to
 * `<canvas>` inside a `requestAnimationFrame` loop.
 *
 * Nothing here writes a signal. On a zoneless application a signal written at 60 Hz is a
 * change-detection storm: every frame would dirty a component tree that has not otherwise
 * changed, and the whole capture screen would re-render sixty times a second to move a line.
 * The elapsed-seconds counter — which changes once a second, not sixty times — is the only
 * thing that becomes state, and `VoiceRecorder` writes it at `audio.meterIntervalMs`.
 *
 * The canvas is decorative: the elapsed counter and the held state carry the meaning
 * (`WEB-UX-042`), so it is `aria-hidden` rather than given an alt text that would announce a
 * moving line sixty times a second.
 */
const CONTEXT_2D = '2d';
const CANVAS_WIDTH = 640;
const CANVAS_HEIGHT = 96;
const BYTE_MIDPOINT = 128;
const HALF = 2;
const LINE_WIDTH = 2.5;
const IDLE_ALPHA = 0.35;

@Component({
  selector: 'foshol-waveform-canvas',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <canvas
      #surface
      class="wave"
      aria-hidden="true"
      [width]="canvasWidth"
      [height]="canvasHeight"
    ></canvas>
  `,
  styles: `
    .wave {
      inline-size: 100%;
      block-size: 4rem;
      border-radius: 0.9rem;
      background: var(--color-paddy-50);
    }
  `,
})
export class WaveformCanvas {
  readonly analyser = input<AnalyserNode | null>(null);

  protected readonly canvasWidth = CANVAS_WIDTH;
  protected readonly canvasHeight = CANVAS_HEIGHT;

  private readonly surface = viewChild.required<ElementRef<HTMLCanvasElement>>('surface');

  constructor() {
    let frame: number | null = null;

    const stop = (): void => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
    };

    effect(() => {
      const analyser = this.analyser();
      stop();

      // jsdom has no 2D context at all, and neither does a browser tab that has run out of
      // GPU contexts. Both are survivable: the recorder still records.
      const context = this.surface().nativeElement.getContext(
        CONTEXT_2D,
      ) as CanvasRenderingContext2D | null;
      if (context === null) return;

      if (analyser === null) {
        drawFlatLine(context);
        return;
      }

      const samples = new Uint8Array(analyser.fftSize);
      const draw = (): void => {
        analyser.getByteTimeDomainData(samples);
        drawWave(context, samples);
        frame = requestAnimationFrame(draw);
      };
      draw();
    });

    inject(DestroyRef).onDestroy(stop);
  }
}

function surfaceStyle(context: CanvasRenderingContext2D): void {
  context.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  context.lineWidth = LINE_WIDTH;
  context.lineJoin = 'round';
  context.strokeStyle = getComputedStyle(context.canvas).getPropertyValue('--color-paddy-600');
}

function drawFlatLine(context: CanvasRenderingContext2D): void {
  surfaceStyle(context);
  context.globalAlpha = IDLE_ALPHA;
  context.beginPath();
  context.moveTo(0, CANVAS_HEIGHT / HALF);
  context.lineTo(CANVAS_WIDTH, CANVAS_HEIGHT / HALF);
  context.stroke();
  context.globalAlpha = 1;
}

function drawWave(context: CanvasRenderingContext2D, samples: Uint8Array): void {
  surfaceStyle(context);
  context.beginPath();
  const step = CANVAS_WIDTH / samples.length;
  for (let index = 0; index < samples.length; index++) {
    // The analyser's time-domain bytes centre on 128; map to the canvas about its midline.
    const amplitude = (samples[index] - BYTE_MIDPOINT) / BYTE_MIDPOINT;
    const y = CANVAS_HEIGHT / HALF + (amplitude * CANVAS_HEIGHT) / HALF;
    const x = index * step;
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.stroke();
}
