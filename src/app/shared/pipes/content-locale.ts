import { APP_CONFIG, type Locale } from '../../core/config/app-config';

/**
 * The one place that decides which locale of a catalogue field to show.
 *
 * The knowledge catalogue now returns both locales in one payload — `nameBn`/`nameEn`,
 * `titleBn`/`titleEn`, `stepsBn`/`stepsEn` and so on, each with a `*EnFallback` flag. Both
 * values are already on the object in memory, so switching language is a re-read, never a
 * refetch (`WEB-UX-012`): nothing here fetches, caches or mutates anything.
 *
 * `COMMON-NFR-038` — when the server sets the fallback flag, the `*En` value **is** the Bangla
 * text copied across. The flag is the only way to know that, and `WEB-UX-015` requires it be
 * shown as a `(bn)` marker while English is the asked-for language.
 *
 * `WEB-UX-016` — nothing here translates, rewrites, concatenates or reformats a content value,
 * and no English is ever invented. When the English side is missing (an older payload, or a
 * field the server chose not to send) the Bangla is shown and marked, which is the honest
 * answer rather than a blank.
 *
 * Pure by construction: the locale arrives as an argument rather than an injected read, so the
 * pipes built on this stay pure and Angular re-evaluates them the moment the toggle writes a
 * new locale.
 */
const EMPTY = 0;

/** One content field, resolved for the active locale. */
export interface ContentView {
  readonly text: string;
  /** English was asked for and this is Bangla — render the `(bn)` marker (`WEB-UX-015`). */
  readonly marked: boolean;
}

/** A content field that is a list of strings, resolved as a unit — `stepsBn` / `stepsEn`. */
export interface ContentListView {
  readonly items: readonly string[];
  readonly marked: boolean;
}

function isBangla(locale: Locale): boolean {
  return locale === APP_CONFIG.i18n.defaultLocale;
}

/**
 * Bangla is the language of record, so in `bn` the Bangla field is shown unmarked — a marker
 * saying "this is Bangla" to a farmer reading Bangla is noise.
 */
export function pickContent(
  bn: string | null | undefined,
  en: string | null | undefined,
  fallback: boolean | null | undefined,
  locale: Locale,
): ContentView {
  const bangla = bn ?? '';
  if (isBangla(locale)) return { text: bangla, marked: false };

  const english = en ?? '';
  // No English side at all: show the Bangla and say so, rather than blanking the field.
  if (english.length === EMPTY) return { text: bangla, marked: bangla.length > EMPTY };
  return { text: english, marked: fallback === true };
}

/**
 * The list form. `stepsEnFallback` is one flag for the whole array — the server either
 * translated the steps or copied them — so the list is marked once rather than per step, and
 * the steps themselves keep the order and wording they arrived in (`WEB-FR-156`).
 */
export function pickContentList(
  bn: readonly string[] | null | undefined,
  en: readonly string[] | null | undefined,
  fallback: boolean | null | undefined,
  locale: Locale,
): ContentListView {
  const bangla = bn ?? [];
  if (isBangla(locale)) return { items: bangla, marked: false };

  const english = en ?? [];
  if (english.length === EMPTY) return { items: bangla, marked: bangla.length > EMPTY };
  return { items: english, marked: fallback === true };
}

/**
 * The plain-text marker, for a context that cannot hold a child element — an `<option>`, an
 * `alt`, an `aria-label`. Everywhere a marker element CAN exist, `<foshol-bn-value>` is used
 * instead, because it also carries the accessible description.
 */
export function appendMarker(text: string, marked: boolean, marker: unknown): string {
  if (!marked || text.length === EMPTY) return text;
  return typeof marker === 'string' && marker.length > EMPTY ? `${text} ${marker}` : text;
}

/** A remedy's four bilingual fields, resolved together for the active locale. */
export interface RemedyContentView {
  readonly title: ContentView;
  readonly steps: ContentListView;
  /** Null when the catalogue has no dosage at all — never a dash, never an invented value. */
  readonly dosage: ContentView | null;
  readonly rateNotes: ContentView | null;
}

/**
 * Resolves every bilingual field on one remedy in one place, so the three components that render
 * remedies — the farmer's FAQ answer, the published advisory card and the officer's remedy
 * editor — cannot drift apart in how they pick a locale.
 *
 * `type`, `phiDays`, `costTier` and `efficacy` are deliberately absent: they are enums and
 * numbers whose *chrome labels* are translated through ngx-translate, never here.
 */
export function pickRemedyContent(
  remedy: {
    readonly titleBn: string;
    readonly titleEn?: string | null;
    readonly titleEnFallback?: boolean;
    readonly stepsBn: readonly string[];
    readonly stepsEn?: readonly string[] | null;
    readonly stepsEnFallback?: boolean;
    readonly dosageBn?: string | null;
    readonly dosageEn?: string | null;
    readonly dosageEnFallback?: boolean;
    readonly rateNotesBn?: string | null;
    readonly rateNotesEn?: string | null;
    readonly rateNotesEnFallback?: boolean;
  },
  locale: Locale,
): RemedyContentView {
  const dosage = pickContent(remedy.dosageBn, remedy.dosageEn, remedy.dosageEnFallback, locale);
  const rateNotes = pickContent(
    remedy.rateNotesBn,
    remedy.rateNotesEn,
    remedy.rateNotesEnFallback,
    locale,
  );
  return {
    title: pickContent(remedy.titleBn, remedy.titleEn, remedy.titleEnFallback, locale),
    steps: pickContentList(remedy.stepsBn, remedy.stepsEn, remedy.stepsEnFallback, locale),
    dosage: dosage.text.length === EMPTY ? null : dosage,
    rateNotes: rateNotes.text.length === EMPTY ? null : rateNotes,
  };
}
