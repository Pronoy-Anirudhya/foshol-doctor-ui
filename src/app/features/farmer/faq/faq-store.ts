import { HttpContext } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { APP_CONFIG } from '../../../core/config/app-config';
import { toProblemView, type ProblemView, HTTP_STATUS } from '../../../core/errors/problem';
import {
  ATTEMPT_CORRELATION_ID,
  REQUEST_TIMEOUT_MS,
} from '../../../core/http/request-attempt.interceptor';
import { LiveAnnouncer } from '../../../core/stores/live-announcer';
import type { DraftAudio } from '../../../core/stores/case-draft-store';
import { newUuid } from '../../../core/util/uuid';
import { FaqService } from '../../../generated/services/faq.service';
import { KnowledgeService } from '../../../generated/services/knowledge.service';
import type { Remedy } from '../../../generated/models/remedy';
import type { VoiceSearchResult } from '../../../generated/models/voice-search-result';

/**
 * The farmer FAQ flow: speak → hear back → **confirm** → read the catalogue entry.
 *
 * Two rules shape every method here, and both are safety rules rather than preferences.
 *
 * 1. **Remedies are never fetched until the farmer confirms a candidate.** A voice interface
 *    mishears; the top candidate of a mishearing is still a plausible-looking disease name, and
 *    auto-revealing its chemical dosage would hand a farmer a pesticide instruction they never
 *    asked for. `confirm()` is the only thing on this class that calls `listRemedies`, and
 *    `search()` explicitly clears any previously confirmed selection.
 * 2. **This is a catalogue lookup, not a diagnosis** (ADR-0003). Nothing here submits a case,
 *    publishes an advisory, or infers that the farmer's own field has anything. It reads rows a
 *    farmer could already reach by tapping through a disease list.
 *
 * Deliberately NOT `providedIn: 'root'` — the page provides it, so leaving the FAQ screen drops
 * the transcript, the candidates and the remedies with it. Nothing here is ever written to
 * durable browser storage (`WEB-DATA-020` names the only two keys this application owns, and
 * neither is a transcript).
 */

export type FaqPhase = 'idle' | 'searching' | 'answered' | 'failed';
export type RemedyPhase = 'idle' | 'loading' | 'loaded' | 'failed';

/** What the farmer confirmed — from a voice candidate, or from the typed fallback list. */
export interface FaqSelection {
  readonly diseaseId: string;
  readonly code: string;
  /** Both locales travel together so the toggle re-reads them without a refetch (WEB-UX-012). */
  readonly nameBn: string;
  readonly nameEn?: string | null;
  readonly nameEnFallback?: boolean;
}

const NONE = 0;

@Injectable()
export class FaqStore {
  private readonly faq = inject(FaqService);
  private readonly knowledge = inject(KnowledgeService);
  private readonly announcer = inject(LiveAnnouncer);

  private readonly _phase = signal<FaqPhase>('idle');
  private readonly _result = signal<VoiceSearchResult | null>(null);
  private readonly _problem = signal<ProblemView | null>(null);

  private readonly _selection = signal<FaqSelection | null>(null);
  private readonly _remedyPhase = signal<RemedyPhase>('idle');
  private readonly _remedies = signal<readonly Remedy[] | null>(null);
  private readonly _remedyProblem = signal<ProblemView | null>(null);

  readonly phase = this._phase.asReadonly();
  readonly result = this._result.asReadonly();
  readonly problem = this._problem.asReadonly();
  readonly selection = this._selection.asReadonly();
  readonly remedyPhase = this._remedyPhase.asReadonly();
  readonly remedies = this._remedies.asReadonly();
  readonly remedyProblem = this._remedyProblem.asReadonly();

  readonly searching = computed(() => this._phase() === 'searching');
  readonly candidates = computed(() => this._result()?.candidates ?? []);

  /**
   * "We transcribed you and matched nothing usable." The server's own `inconclusive` flag is
   * authoritative; an empty candidate list is the same outcome arriving a different way. Nothing
   * here re-scores or re-ranks — that would be re-implementing a backend rule (`WEB-NFR-001`).
   */
  readonly inconclusive = computed(() => {
    const result = this._result();
    if (result === null) return false;
    return result.inconclusive || result.candidates.length === NONE;
  });

  /**
   * The sidecar is down (`503`). The catalogue itself is still perfectly readable over
   * `GET /crops/{cropId}/diseases`, so the page degrades to the typed list rather than dying.
   */
  readonly sidecarUnavailable = computed(
    () => this._problem()?.status === HTTP_STATUS.serviceUnavailable,
  );

  /** Monotonic guards: a slow first attempt must never overwrite a fast second one. */
  #searchSeq = NONE;
  #remedySeq = NONE;

  async search(cropId: string, clip: DraftAudio): Promise<void> {
    const seq = ++this.#searchSeq;

    this._phase.set('searching');
    this._problem.set(null);
    this._result.set(null);
    // Rule 1: a new question retracts the previous confirmation and its remedies with it.
    this.#clearSelection();
    this.announcer.announce('farmer.faq.announce.searching');

    // A new interaction, so a correlation id of its own rather than the remembered one; and a
    // ceiling, because ASR is slow enough that "still working" and "never coming" look alike.
    const context = new HttpContext()
      .set(ATTEMPT_CORRELATION_ID, newUuid())
      .set(REQUEST_TIMEOUT_MS, APP_CONFIG.faq.requestTimeoutMs);

    try {
      const result = await this.faq.voiceSearchFaq(
        {
          /*
           * An ASR hint — the language the farmer is SPEAKING — and deliberately not the UI
           * toggle. A farmer reading the interface in English still speaks Bangla into the
           * microphone, and binding this to the toggle would hand Whisper the wrong language and
           * wreck the transcription. The response carries both locales regardless of what is
           * sent here, so the toggle needs no say in it.
           */
          preferred_language: APP_CONFIG.i18n.defaultLocale,
          body: { cropId, audio: clip.blob },
        },
        context,
      );
      if (seq !== this.#searchSeq) return;
      this._result.set(result);
      this._phase.set('answered');
      this.announcer.announce(
        this.inconclusive() ? 'farmer.faq.announce.noMatch' : 'farmer.faq.announce.answered',
      );
    } catch (caught: unknown) {
      if (seq !== this.#searchSeq) return;
      this._problem.set(toProblemView(caught));
      this._phase.set('failed');
      this.announcer.announce('farmer.faq.announce.failed');
    }
  }

  /**
   * The farmer tapped a disease. THIS is the only door to remedy text, and it is opened by an
   * explicit deliberate gesture — never by a ranking.
   */
  async confirm(selection: FaqSelection): Promise<void> {
    const seq = ++this.#remedySeq;

    this._selection.set(selection);
    this._remedyPhase.set('loading');
    this._remedyProblem.set(null);
    this._remedies.set(null);

    try {
      const remedies = await this.knowledge.listRemedies({ diseaseId: selection.diseaseId });
      if (seq !== this.#remedySeq) return;
      this._remedies.set(remedies);
      this._remedyPhase.set('loaded');
      this.announcer.announce('farmer.faq.announce.remedies');
    } catch (caught: unknown) {
      if (seq !== this.#remedySeq) return;
      this._remedyProblem.set(toProblemView(caught));
      this._remedyPhase.set('failed');
      this.announcer.announce('farmer.faq.announce.failed');
    }
  }

  /** Back out of a confirmation — the candidates stay on screen, the remedy text goes away. */
  clearSelection(): void {
    this.#clearSelection();
  }

  /** Ask something else: everything the previous question produced is dropped. */
  reset(): void {
    this.#searchSeq += 1;
    this._phase.set('idle');
    this._result.set(null);
    this._problem.set(null);
    this.#clearSelection();
  }

  #clearSelection(): void {
    this.#remedySeq += 1;
    this._selection.set(null);
    this._remedies.set(null);
    this._remedyPhase.set('idle');
    this._remedyProblem.set(null);
  }
}
