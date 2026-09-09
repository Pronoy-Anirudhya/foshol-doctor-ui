import { APP_CONFIG } from '../../../core/config/app-config';
import {
  isEmptyParse,
  normaliseBanglaDigits,
  parseBanglaQuantity,
  tokeniseBanglaSpeech,
} from './bangla-quantity';

/**
 * The dictation pre-fill is the one place in the capture flow where a machine guess reaches a
 * field the officer's remedy dose is reckoned from, so its grammar is pinned here rather than
 * left to the demo. Every case below is either a shape the parser must understand or a shape it
 * must refuse — and the refusals matter more than the successes.
 */
describe('parseBanglaQuantity — numerals and number words', () => {
  it('reads Bangla digits as the numbers they are', () => {
    expect(parseBanglaQuantity('১০ শতক')).toEqual({ fieldArea: 10, fieldAreaUnit: 'DECIMAL' });
    expect(normaliseBanglaDigits('২৫০')).toBe('250');
  });

  it('reads ASCII digits and decimals, which is what a recogniser usually emits', () => {
    expect(parseBanglaQuantity('2.5 একর')).toEqual({ fieldArea: 2.5, fieldAreaUnit: 'ACRE' });
  });

  it('reads the number words', () => {
    expect(parseBanglaQuantity('পাঁচ একর')).toEqual({ fieldArea: 5, fieldAreaUnit: 'ACRE' });
    expect(parseBanglaQuantity('বিশ শতক')).toEqual({ fieldArea: 20, fieldAreaUnit: 'DECIMAL' });
    expect(parseBanglaQuantity('পঞ্চাশ শতাংশ')).toEqual({
      fieldArea: 50,
      fieldAreaUnit: 'DECIMAL',
    });
  });

  it('reads the hundreds and thousands forms', () => {
    expect(parseBanglaQuantity('একশ কেজি')).toEqual({ cropQuantity: 100, cropQuantityUnit: 'KG' });
    expect(parseBanglaQuantity('একশো কেজি')).toEqual({ cropQuantity: 100, cropQuantityUnit: 'KG' });
    expect(parseBanglaQuantity('দুইশ কেজি')).toEqual({ cropQuantity: 200, cropQuantityUnit: 'KG' });
    expect(parseBanglaQuantity('দুই হাজার কেজি')).toEqual({
      cropQuantity: 2000,
      cropQuantityUnit: 'KG',
    });
    // `দশ`, `বিশ` and `পঞ্চাশ` all end in `শ` and are not hundreds.
    expect(parseBanglaQuantity('দশ কেজি')).toEqual({ cropQuantity: 10, cropQuantityUnit: 'KG' });
  });

  it('reads the fraction words', () => {
    expect(parseBanglaQuantity('আধা একর')).toEqual({ fieldArea: 0.5, fieldAreaUnit: 'ACRE' });
    expect(parseBanglaQuantity('দেড় হেক্টর')).toEqual({ fieldArea: 1.5, fieldAreaUnit: 'HECTARE' });
    expect(parseBanglaQuantity('সাড়ে তিন শতক')).toEqual({
      fieldArea: 3.5,
      fieldAreaUnit: 'DECIMAL',
    });
  });
});

describe('parseBanglaQuantity — the unit lexicon', () => {
  it('maps every area keyword onto the generated area union', () => {
    expect(parseBanglaQuantity('তিন শতক').fieldAreaUnit).toBe('DECIMAL');
    expect(parseBanglaQuantity('তিন শতাংশ').fieldAreaUnit).toBe('DECIMAL');
    expect(parseBanglaQuantity('তিন বর্গমিটার').fieldAreaUnit).toBe('SQ_M');
    expect(parseBanglaQuantity('তিন বর্গফুট').fieldAreaUnit).toBe('SQ_FT');
    expect(parseBanglaQuantity('তিন হেক্টর').fieldAreaUnit).toBe('HECTARE');
    expect(parseBanglaQuantity('তিন একর').fieldAreaUnit).toBe('ACRE');
  });

  it('maps every quantity keyword onto the generated quantity union', () => {
    expect(parseBanglaQuantity('তিন কেজি').cropQuantityUnit).toBe('KG');
    expect(parseBanglaQuantity('তিন কিলো').cropQuantityUnit).toBe('KG');
    expect(parseBanglaQuantity('তিন টন').cropQuantityUnit).toBe('TON');
    expect(parseBanglaQuantity('তিন গাছ').cropQuantityUnit).toBe('PLANTS');
    expect(parseBanglaQuantity('তিন চারা').cropQuantityUnit).toBe('PLANTS');
  });

  /**
   * The area union has no bigha at all, so mapping `বিঘা` onto one would mean inventing a
   * conversion the contract never states. It is a QUANTITY unit, `BIGHAS_EQUIV`, and it must
   * never leak into the area fields.
   */
  it('treats বিঘা as a quantity unit and never as an area unit', () => {
    expect(parseBanglaQuantity('তিন বিঘা')).toEqual({
      cropQuantity: 3,
      cropQuantityUnit: 'BIGHAS_EQUIV',
    });
  });
});

describe('parseBanglaQuantity — a whole sentence', () => {
  it('reads an area and a quantity out of one sentence', () => {
    expect(parseBanglaQuantity('দশ শতক জমি, দুইশ কেজি ধান')).toEqual({
      fieldArea: 10,
      fieldAreaUnit: 'DECIMAL',
      cropQuantity: 200,
      cropQuantityUnit: 'KG',
    });
  });

  it('survives the punctuation a recogniser leaves behind', () => {
    expect(parseBanglaQuantity('আমার জমি দশ শতক। ফসল দুইশ কেজি।')).toEqual({
      fieldArea: 10,
      fieldAreaUnit: 'DECIMAL',
      cropQuantity: 200,
      cropQuantityUnit: 'KG',
    });
  });

  it('tokenises on whitespace and punctuation, keeping an inner decimal point', () => {
    expect(tokeniseBanglaSpeech('দশ শতক, ২.৫ একর।')).toEqual(['দশ', 'শতক', '2.5', 'একর']);
  });
});

describe('parseBanglaQuantity — everything it must refuse', () => {
  it('yields nothing for empty or meaningless input', () => {
    expect(parseBanglaQuantity('')).toEqual({});
    expect(parseBanglaQuantity('   ')).toEqual({});
    expect(parseBanglaQuantity('!!! ??? ...')).toEqual({});
    expect(parseBanglaQuantity('আমার ধান খারাপ হয়ে গেছে')).toEqual({});
    expect(isEmptyParse(parseBanglaQuantity(''))).toBe(true);
  });

  it('yields no unit — and therefore no value — for a unit it does not know', () => {
    // `মণ` is a real Bangladeshi unit and is deliberately absent from both unions.
    expect(parseBanglaQuantity('দশ মণ')).toEqual({});
    expect(parseBanglaQuantity('দশ')).toEqual({});
  });

  it('ignores a unit with no number in front of it', () => {
    expect(parseBanglaQuantity('শতক জমি')).toEqual({});
    expect(parseBanglaQuantity('সাড়ে শতক')).toEqual({});
  });

  it('drops a value outside the intake bounds rather than clamping it into a plausible lie', () => {
    const bounds = APP_CONFIG.intake.metrics;
    expect(parseBanglaQuantity(`${bounds.fieldAreaMax + 1} শতক`)).toEqual({});
    expect(parseBanglaQuantity(`${bounds.cropQuantityMax + 1} কেজি`)).toEqual({});
    // Zero clears no minimum, so it is not an area the farmer stated.
    expect(parseBanglaQuantity('0 শতক')).toEqual({});
  });

  it('drops the field when the sentence gives two different answers for it', () => {
    expect(parseBanglaQuantity('দশ শতক আর বিশ শতক')).toEqual({});
    expect(parseBanglaQuantity('দশ শতক আর দশ একর')).toEqual({});
    // The unambiguous half of an otherwise contradictory sentence still comes through.
    expect(parseBanglaQuantity('দশ শতক আর বিশ শতক, দুইশ কেজি ধান')).toEqual({
      cropQuantity: 200,
      cropQuantityUnit: 'KG',
    });
  });

  it('keeps a repeated but identical reading', () => {
    expect(parseBanglaQuantity('দশ শতক, হ্যাঁ দশ শতক')).toEqual({
      fieldArea: 10,
      fieldAreaUnit: 'DECIMAL',
    });
  });
});
