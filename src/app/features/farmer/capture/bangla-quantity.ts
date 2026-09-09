import { APP_CONFIG } from '../../../core/config/app-config';
import type { CropQuantityUnit, FieldAreaUnit } from '../../../core/stores/case-draft-store';

/**
 * "দশ শতক জমি, দুইশ কেজি ধান" → `{ fieldArea: 10, fieldAreaUnit: 'DECIMAL', cropQuantity: 200,
 * cropQuantityUnit: 'KG' }`.
 *
 * A **typing aid** for the land step and nothing more (`DEVIATIONS.md` D-23). The farmer's own
 * typed values are still what the multipart body carries, and the SERVER alone decides
 * `CaseDetail.metricsSource` (`WEB-NFR-001`) — this file forms no opinion about that and the
 * dictated audio is never attached to the case.
 *
 * Deliberately free of Angular so it is a plain unit under jsdom (`bangla-quantity.spec.ts`).
 * `APP_CONFIG` is a frozen constant module, not a framework import, and the bounds have to come
 * from it: `WEB-NFR-009` forbids a threshold written here.
 *
 * Three rules make this safe to point at a farmer's submission:
 *
 *  1. **An unrecognised unit yields no unit, and therefore no value.** A number with no unit we
 *     recognise could belong to either field under either union member; writing it anywhere is a
 *     guess, and the whole point of the pre-fill is to save typing, not to invent measurements.
 *  2. **A value outside the `intake.metrics` bounds is dropped, never clamped.** Clamping turns a
 *     misheard "পঞ্চাশ হাজার" into a plausible-looking figure the farmer has no reason to doubt.
 *  3. **Ambiguity yields nothing.** Two conflicting areas in one sentence is a coin flip, and a
 *     coin flip in a field the officer's dose is reckoned from is worse than an empty box.
 */
export interface ParsedLandSpeech {
  readonly fieldArea?: number;
  readonly fieldAreaUnit?: FieldAreaUnit;
  readonly cropQuantity?: number;
  readonly cropQuantityUnit?: CropQuantityUnit;
}

const BANGLA_DIGITS = '০১২৩৪৫৬৭৮৯';
const BANGLA_DIGIT_PATTERN = /[০-৯]/gu;
/** Whitespace, the danda, and the punctuation a recogniser sprinkles through a sentence. */
const SEPARATORS = /[\s,;:!?()"'।‘’“”]+/u;
/** Only a leading/trailing dot may be stripped: an inner one is the decimal point in `2.5`. */
const EDGE_PUNCTUATION = /^[.।·-]+|[.।·-]+$/gu;
const PLAIN_NUMBER = /^\d+(?:\.\d+)?$/u;

const HUNDRED = 100;
const THOUSAND = 1000;
const HALF = 0.5;
const ONE_AND_A_HALF = 1.5;
const NOTHING = 0;
const ONCE = 1;
const FIRST = 0;

/** The lexicon. Numbers here are the words' own values, not thresholds. */
const ONES: ReadonlyMap<string, number> = new Map([
  ['এক', 1],
  ['দুই', 2],
  ['তিন', 3],
  ['চার', 4],
  ['পাঁচ', 5],
  ['ছয়', 6],
  ['সাত', 7],
  ['আট', 8],
  ['নয়', 9],
  ['দশ', 10],
]);

const TENS: ReadonlyMap<string, number> = new Map([
  ['বিশ', 20],
  ['ত্রিশ', 30],
  ['চল্লিশ', 40],
  ['পঞ্চাশ', 50],
]);

/** Longest first, so `একশো` is not read as `একশ` plus a stray `ো`. */
const HUNDRED_SUFFIXES: readonly string[] = ['শো', 'শত', 'শ'];

const PLUS_HALF_WORD = 'সাড়ে';
const THOUSAND_WORD = 'হাজার';
const ONE_AND_A_HALF_WORD = 'দেড়';
const HALF_WORD = 'আধা';

/**
 * Only the members the generated multipart schema actually has. `বিঘা` is deliberately a
 * **quantity** unit: the area union carries no bigha, so mapping it to an area member would be
 * inventing a conversion factor the contract never states.
 */
const AREA_UNITS: ReadonlyMap<string, FieldAreaUnit> = new Map([
  ['শতক', 'DECIMAL'],
  ['শতাংশ', 'DECIMAL'],
  ['বর্গমিটার', 'SQ_M'],
  ['বর্গফুট', 'SQ_FT'],
  ['হেক্টর', 'HECTARE'],
  ['একর', 'ACRE'],
]);

const QUANTITY_UNITS: ReadonlyMap<string, CropQuantityUnit> = new Map([
  ['কেজি', 'KG'],
  ['কিলো', 'KG'],
  ['টন', 'TON'],
  ['গাছ', 'PLANTS'],
  ['চারা', 'PLANTS'],
  ['বিঘা', 'BIGHAS_EQUIV'],
]);

const VALUE_ATOM = 'VALUE';
const HALF_ATOM = 'HALF';
const THOUSAND_ATOM = 'THOUSAND';

type Atom =
  | { readonly kind: typeof VALUE_ATOM; readonly value: number }
  | { readonly kind: typeof HALF_ATOM }
  | { readonly kind: typeof THOUSAND_ATOM };

interface Reading<TUnit> {
  readonly value: number;
  readonly unit: TUnit;
}

/** `১০` → `10`. Everything downstream then works on one numeral system. */
export function normaliseBanglaDigits(text: string): string {
  return text.replaceAll(BANGLA_DIGIT_PATTERN, (digit) => String(BANGLA_DIGITS.indexOf(digit)));
}

/**
 * `দুইশ` → 200, `একশো` → 100. Checked only after the exact word maps, because `দশ`, `বিশ`,
 * `চল্লিশ` and `পঞ্চাশ` all end in `শ` and are not hundreds.
 */
function hundredsOf(token: string): number | null {
  for (const suffix of HUNDRED_SUFFIXES) {
    if (!token.endsWith(suffix) || token.length === suffix.length) continue;
    const stem = token.slice(NOTHING, token.length - suffix.length);
    const ones = ONES.get(stem);
    if (ones !== undefined) return ones * HUNDRED;
  }
  return null;
}

function atomOf(token: string): Atom | null {
  if (token === PLUS_HALF_WORD) return { kind: HALF_ATOM };
  if (token === THOUSAND_WORD) return { kind: THOUSAND_ATOM };
  if (token === ONE_AND_A_HALF_WORD) return { kind: VALUE_ATOM, value: ONE_AND_A_HALF };
  if (token === HALF_WORD) return { kind: VALUE_ATOM, value: HALF };

  const ones = ONES.get(token);
  if (ones !== undefined) return { kind: VALUE_ATOM, value: ones };
  const tens = TENS.get(token);
  if (tens !== undefined) return { kind: VALUE_ATOM, value: tens };
  const hundreds = hundredsOf(token);
  if (hundreds !== null) return { kind: VALUE_ATOM, value: hundreds };

  if (PLAIN_NUMBER.test(token)) {
    const parsed = Number(token);
    return Number.isFinite(parsed) ? { kind: VALUE_ATOM, value: parsed } : null;
  }
  return null;
}

/**
 * Left to right: values add (`একশ বিশ` = 120), `হাজার` multiplies what stands before it
 * (`দুই হাজার` = 2000), and `সাড়ে` adds a half to whatever the run comes to (`সাড়ে তিন` = 3.5).
 * A run with no value in it at all — a bare `সাড়ে` — is not a number.
 */
function evaluate(atoms: readonly Atom[]): number | null {
  let total = NOTHING;
  let current = NOTHING;
  let plusHalf = false;
  let sawValue = false;

  for (const atom of atoms) {
    if (atom.kind === HALF_ATOM) {
      plusHalf = true;
      continue;
    }
    if (atom.kind === THOUSAND_ATOM) {
      total += (current === NOTHING ? ONCE : current) * THOUSAND;
      current = NOTHING;
      sawValue = true;
      continue;
    }
    current += atom.value;
    sawValue = true;
  }

  if (!sawValue) return null;
  return total + current + (plusHalf ? HALF : NOTHING);
}

/** The maximal run of number words immediately before a unit word is that unit's value. */
function runBefore(tokens: readonly string[], unitIndex: number): number | null {
  const atoms: Atom[] = [];
  for (let index = unitIndex - ONCE; index >= FIRST; index -= ONCE) {
    const atom = atomOf(tokens[index]);
    if (atom === null) break;
    atoms.unshift(atom);
  }
  return evaluate(atoms);
}

/** One reading, or none: disagreement between two readings of the same field is not resolvable. */
function settle<TUnit>(readings: readonly Reading<TUnit>[]): Reading<TUnit> | null {
  if (readings.length === NOTHING) return null;
  const [first, ...rest] = readings;
  for (const other of rest) {
    if (other.value !== first.value || other.unit !== first.unit) return null;
  }
  return first;
}

function within(value: number, min: number, max: number): boolean {
  return Number.isFinite(value) && value >= min && value <= max;
}

export function tokeniseBanglaSpeech(text: string): readonly string[] {
  return normaliseBanglaDigits(text)
    .split(SEPARATORS)
    .map((token) => token.replaceAll(EDGE_PUNCTUATION, ''))
    .filter((token) => token.length > NOTHING);
}

/**
 * Everything the sentence says with enough confidence to type into a box for the farmer. Fields
 * it is not sure about are simply absent, so the caller applies a partial and leaves the rest
 * exactly as the farmer left it.
 */
export function parseBanglaQuantity(text: string): ParsedLandSpeech {
  const tokens = tokeniseBanglaSpeech(text);

  const areas: Reading<FieldAreaUnit>[] = [];
  const quantities: Reading<CropQuantityUnit>[] = [];

  for (let index = FIRST; index < tokens.length; index += ONCE) {
    const token = tokens[index];
    const areaUnit = AREA_UNITS.get(token);
    const quantityUnit = QUANTITY_UNITS.get(token);
    if (areaUnit === undefined && quantityUnit === undefined) continue;

    // A unit with no number in front of it ("শতক জমি") states no measurement.
    const value = runBefore(tokens, index);
    if (value === null) continue;

    if (areaUnit !== undefined) areas.push({ value, unit: areaUnit });
    if (quantityUnit !== undefined) quantities.push({ value, unit: quantityUnit });
  }

  const area = settle(areas);
  const quantity = settle(quantities);
  const bounds = APP_CONFIG.intake.metrics;

  let parsed: ParsedLandSpeech = {};
  if (area !== null && within(area.value, bounds.fieldAreaMin, bounds.fieldAreaMax)) {
    parsed = { ...parsed, fieldArea: area.value, fieldAreaUnit: area.unit };
  }
  if (
    quantity !== null &&
    within(quantity.value, bounds.cropQuantityMin, bounds.cropQuantityMax)
  ) {
    parsed = { ...parsed, cropQuantity: quantity.value, cropQuantityUnit: quantity.unit };
  }
  return parsed;
}

/** `true` when there is nothing to apply, so the caller can say so rather than flashing nothing. */
export function isEmptyParse(parsed: ParsedLandSpeech): boolean {
  return parsed.fieldArea === undefined && parsed.cropQuantity === undefined;
}
