import { describe, expect, it } from 'vitest';
import { pickContent, pickContentList, pickRemedyContent } from './content-locale';

/**
 * The rules every catalogue surface now depends on, asserted once here rather than re-derived in
 * each component's spec.
 *
 * The two that matter most are the ones that are easy to get backwards: Bangla is the language
 * of record so it is NEVER marked, and a missing English side falls back to Bangla **marked**
 * rather than rendering an empty field or inventing a translation (`WEB-UX-016`).
 */
const BN = 'ধানের ব্লাস্ট';
const EN = 'Rice blast';

describe('pickContent', () => {
  it('shows Bangla unmarked in Bangla, whatever the fallback flag says', () => {
    expect(pickContent(BN, EN, false, 'bn')).toEqual({ text: BN, marked: false });
    // The flag only means something while English is being asked for.
    expect(pickContent(BN, BN, true, 'bn')).toEqual({ text: BN, marked: false });
  });

  it('shows English unmarked when the catalogue has a real translation', () => {
    expect(pickContent(BN, EN, false, 'en')).toEqual({ text: EN, marked: false });
  });

  it('marks the value when the server says the English is a Bangla copy', () => {
    // COMMON-NFR-038 — `*En` IS the Bangla text; the flag is the only way to know.
    expect(pickContent(BN, BN, true, 'en')).toEqual({ text: BN, marked: true });
  });

  it.each([[null], [undefined], ['']])(
    'falls back to marked Bangla when the English side is %s',
    (en) => {
      expect(pickContent(BN, en as string | null | undefined, false, 'en')).toEqual({
        text: BN,
        marked: true,
      });
    },
  );

  it('never marks an empty field — there is nothing there to explain', () => {
    expect(pickContent(null, null, true, 'en')).toEqual({ text: '', marked: false });
  });
});

describe('pickContentList', () => {
  it('marks the list once as a unit, because the server sets one flag for the array', () => {
    expect(pickContentList(['ক', 'খ'], ['ক', 'খ'], true, 'en')).toEqual({
      items: ['ক', 'খ'],
      marked: true,
    });
  });

  it('keeps the order and wording it arrived in (WEB-FR-156)', () => {
    const steps = ['first', 'second', 'third'];
    expect(pickContentList(['ক'], steps, false, 'en').items).toEqual(steps);
  });

  it('falls back to the Bangla steps when the English array is empty or absent', () => {
    expect(pickContentList(['ক', 'খ'], [], false, 'en')).toEqual({
      items: ['ক', 'খ'],
      marked: true,
    });
    expect(pickContentList(['ক'], null, false, 'en').items).toEqual(['ক']);
  });
});

describe('pickRemedyContent', () => {
  const remedy = {
    titleBn: BN,
    titleEn: EN,
    titleEnFallback: false,
    stepsBn: ['ধাপ এক'],
    stepsEn: ['Step one'],
    stepsEnFallback: false,
    dosageBn: 'নিম তেল ৩ মিলি প্রতি লিটার',
    dosageEn: null,
    rateNotesBn: null,
    rateNotesEn: null,
  };

  it('resolves every bilingual field of one remedy together', () => {
    const view = pickRemedyContent(remedy, 'en');

    expect(view.title.text).toBe(EN);
    expect(view.steps.items).toEqual(['Step one']);
    // No English dosage: the Bangla stands, marked, digits untouched (WEB-UX-016).
    expect(view.dosage).toEqual({ text: remedy.dosageBn, marked: true });
  });

  it('leaves an absent dosage absent — never a dash, never an invented value', () => {
    const view = pickRemedyContent({ ...remedy, dosageBn: null }, 'en');

    expect(view.dosage).toBeNull();
    expect(view.rateNotes).toBeNull();
  });

  it('returns Bangla throughout when Bangla is the active locale', () => {
    const view = pickRemedyContent(remedy, 'bn');

    expect(view.title).toEqual({ text: BN, marked: false });
    expect(view.steps).toEqual({ items: ['ধাপ এক'], marked: false });
    expect(view.dosage).toEqual({ text: remedy.dosageBn, marked: false });
  });
});
