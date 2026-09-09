import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { APP_CONFIG } from '../../../core/config/app-config';

/**
 * The capture stepper's spoken guidance, in Bangla, for a farmer who may not read
 * (`DEVIATIONS.md` D-23).
 *
 * Page-scoped, like `VoiceRecorder` — provided by `CapturePage`, so leaving the page tears it
 * down and nothing carries on talking over the next screen.
 *
 * **Degrades silently by design.** Where there is no `speechSynthesis`, no
 * `SpeechSynthesisUtterance` or no usable voice, `supported()` stays `false`, the guide controls
 * are not rendered and every call here is a no-op. Nothing is lost: each step's instruction is
 * the same sentence that is already printed on the card, so speech is a second channel and never
 * the only one (`WEB-UX-013` keeps that sentence a translation key, which is what makes speaking
 * it possible at all).
 *
 * **Mute is memory-only.** `APP_CONFIG.storageKeys` names the only two `localStorage` keys this
 * application owns; a preference is not worth becoming the third.
 */
const VOICES_CHANGED = 'voiceschanged';
const BANGLA_LANG_PREFIX = 'bn';
/** Bangladeshi Bangla. `bn-IN` is West Bengal — intelligible, but audibly not local. */
const BANGLADESH_LANG = 'bn-bd';
const EMPTY = 0;

/**
 * Name fragments that mark a platform's *good* voice, lower-cased for comparison.
 *
 * Every major platform ships two tiers under the same language and distinguishes them only in
 * the voice's NAME: Chrome's network "Google বাংলা", Apple's "Enhanced"/"Premium" downloads and
 * Siri voices, Microsoft's "Natural"/"Neural" ones. `SpeechSynthesisVoice` exposes no quality
 * field, so the name is the only signal available.
 */
const GOOD_VOICE_HINTS = ['google', 'natural', 'neural', 'enhanced', 'premium', 'siri'];

/** The low-tier formant voices — the robotic ones this ranking exists to avoid. */
const POOR_VOICE_HINTS = ['compact', 'eloquence'];

/** `window.speechSynthesis` is typed non-optional by lib.dom, but is absent in plenty of runtimes. */
interface SpeechCapableWindow {
  readonly speechSynthesis?: SpeechSynthesis;
  readonly SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance;
}

@Injectable()
export class VoiceGuide {
  private readonly translate = inject(TranslateService);

  private readonly _muted = signal(false);
  private readonly _supported = signal(false);
  private readonly _speaking = signal(false);

  readonly muted = this._muted.asReadonly();
  readonly supported = this._supported.asReadonly();
  readonly speaking = this._speaking.asReadonly();

  #synth: SpeechSynthesis | null = null;
  #utteranceCtor: typeof SpeechSynthesisUtterance | null = null;
  #voice: SpeechSynthesisVoice | null = null;

  constructor() {
    const destroyRef = inject(DestroyRef);
    const platform: SpeechCapableWindow | undefined =
      typeof window === 'undefined' ? undefined : window;
    const synth = platform?.speechSynthesis;
    const utteranceCtor = platform?.SpeechSynthesisUtterance;
    if (synth === undefined || utteranceCtor === undefined) return;

    this.#synth = synth;
    this.#utteranceCtor = utteranceCtor;
    this._supported.set(true);
    this.#chooseVoice();

    // `getVoices()` is empty until the platform has loaded its voice list, which on Chrome
    // happens asynchronously and only ever announces itself through this event.
    const onVoicesChanged = (): void => this.#chooseVoice();
    synth.addEventListener(VOICES_CHANGED, onVoicesChanged);
    destroyRef.onDestroy(() => {
      synth.removeEventListener(VOICES_CHANGED, onVoicesChanged);
      this.cancel();
    });
  }

  /**
   * Speak the sentence behind a translation key. Cancels first, so arriving at a new step never
   * leaves two instructions talking over each other.
   */
  speak(key: string): void {
    const synth = this.#synth;
    const utteranceCtor = this.#utteranceCtor;
    if (synth === null || utteranceCtor === null) return;

    this.cancel();
    if (this._muted()) return;

    const text: unknown = this.translate.instant(key);
    if (typeof text !== 'string' || text.length === EMPTY) return;

    const utterance = new utteranceCtor(text);
    utterance.lang = APP_CONFIG.speech.recognitionLang;
    utterance.rate = APP_CONFIG.speech.guideRate;
    utterance.pitch = APP_CONFIG.speech.guidePitch;
    if (this.#voice !== null) utterance.voice = this.#voice;
    utterance.onend = (): void => this._speaking.set(false);
    utterance.onerror = (): void => this._speaking.set(false);

    try {
      synth.speak(utterance);
      this._speaking.set(true);
    } catch {
      // A refused or unavailable synthesiser is silence, not an error the farmer must read.
      this._speaking.set(false);
    }
  }

  cancel(): void {
    this._speaking.set(false);
    try {
      this.#synth?.cancel();
    } catch {
      /* Cancelling a synthesiser that has nothing queued is not a failure. */
    }
  }

  /** Muting also stops what is being said now — otherwise the control appears not to work. */
  toggleMute(): void {
    const next = !this._muted();
    this._muted.set(next);
    if (next) this.cancel();
  }

  /**
   * Picks the most natural Bangla voice the platform has, in order of preference.
   *
   * `getVoices()` returns platform order, not quality order, so taking the first `bn` match —
   * which is what this did — reliably selected the low-tier compact voice on both macOS and
   * Android. That is the robotic delivery this ranking replaces.
   *
   * Preference runs dialect first, then quality: a Bangladeshi farmer hears `bn-IN` as a
   * foreign accent, so a plain `bn-BD` voice beats an enhanced West Bengal one. Within a
   * dialect, a named good voice beats an unmarked one, which beats a known-poor one.
   *
   * Falls through to the platform default (`null`) when there is no Bangla voice at all — it
   * reads Bangla badly, but is still better than silence for someone who cannot read the card.
   */
  #chooseVoice(): void {
    const synth = this.#synth;
    if (synth === null) return;
    let voices: readonly SpeechSynthesisVoice[] = [];
    try {
      voices = synth.getVoices();
    } catch {
      return;
    }

    const bangla = voices.filter((voice) => voice.lang.toLowerCase().startsWith(BANGLA_LANG_PREFIX));
    if (bangla.length === EMPTY) {
      this.#voice = null;
      return;
    }

    const local = (voice: SpeechSynthesisVoice): boolean =>
      voice.lang.toLowerCase().replace('_', '-') === BANGLADESH_LANG;
    const named = (voice: SpeechSynthesisVoice, hints: readonly string[]): boolean => {
      const name = voice.name.toLowerCase();
      return hints.some((hint) => name.includes(hint));
    };
    const good = (voice: SpeechSynthesisVoice): boolean => named(voice, GOOD_VOICE_HINTS);
    const poor = (voice: SpeechSynthesisVoice): boolean => named(voice, POOR_VOICE_HINTS);

    // Ordered predicates rather than a numeric score, so the ranking reads as the sentence it
    // is and no weights need justifying (WEB-NFR-009).
    const preference: readonly ((voice: SpeechSynthesisVoice) => boolean)[] = [
      (voice) => local(voice) && good(voice),
      (voice) => local(voice) && !poor(voice),
      (voice) => local(voice),
      (voice) => good(voice),
      (voice) => !poor(voice),
      () => true,
    ];

    for (const matches of preference) {
      const found = bangla.find(matches);
      if (found !== undefined) {
        this.#voice = found;
        return;
      }
    }
  }
}
