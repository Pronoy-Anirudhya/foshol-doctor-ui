import { TestBed } from '@angular/core/testing';
import { APP_CONFIG } from '../../core/config/app-config';
import type { ProblemView } from '../../core/errors/problem';
import type { FarmerRecord } from '../../generated/models/farmer-record';
import type { PageOfFarmerRecord } from '../../generated/models/page-of-farmer-record';
import { FarmerDirectoryStore } from './farmer-directory-store';

function record(id: string, name: string): FarmerRecord {
  return {
    id,
    name,
    divisionCode: '30',
    districtCode: '3026',
    divisionNameBn: 'ঢাকা',
    divisionNameEn: 'Dhaka',
    districtNameBn: 'গাজীপুর',
    districtNameEn: 'Gazipur',
    preferredLanguage: 'bn',
    createdAt: '2026-09-07T10:00:00Z',
    registeredByOfficerId: 'o-1',
    registeredByName: 'Amina Khatun',
    source: 'MANUAL',
  };
}

function page(content: readonly FarmerRecord[]): PageOfFarmerRecord {
  return {
    content: [...content],
    page: 0,
    size: APP_CONFIG.page.defaultSize,
    totalElements: content.length,
    totalPages: content.length === 0 ? 0 : 1,
  };
}

const PROBLEM = { status: 400, code: 'ERR_BAD_REQUEST' } as ProblemView;

describe('FarmerDirectoryStore', () => {
  let store: FarmerDirectoryStore;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [FarmerDirectoryStore] });
    store = TestBed.inject(FarmerDirectoryStore);
  });

  describe('the q/phone exclusion (WEB-FR-312)', () => {
    it('drops the phone lookup when a name search is set', () => {
      store.setPhoneLookup('+8801712345678');
      store.setQuery('রহিম');

      expect(store.filters().q).toBe('রহিম');
      expect(store.filters().phone).toBeNull();
    });

    it('drops the name search when a phone lookup is set', () => {
      store.setQuery('রহিম');
      store.setPhoneLookup('+8801712345678');

      expect(store.filters().phone).toBe('+8801712345678');
      expect(store.filters().q).toBeNull();
    });

    it('never holds both at once, whatever order the two are called in', () => {
      for (const call of [
        () => store.setQuery('a'),
        () => store.setPhoneLookup('01712345678'),
        () => store.setQuery('b'),
        () => store.setPhoneLookup('01812345678'),
      ]) {
        call();
        const { q, phone } = store.filters();
        expect(q === null || phone === null).toBe(true);
      }
    });

    it('treats a blank or whitespace-only box as no filter at all', () => {
      store.setQuery('   ');
      expect(store.filters().q).toBeNull();
      expect(store.searchActive()).toBe(false);
    });

    it('trims what it does send, so a stray space is not part of the search', () => {
      store.setQuery('  রহিম  ');
      expect(store.filters().q).toBe('রহিম');
    });

    it('returns to the first page whenever the search changes', () => {
      store.goToPage(3);
      store.setQuery('রহিম');
      expect(store.filters().page).toBe(0);
    });
  });

  describe('load', () => {
    it('adopts the server page verbatim, preserving its order', async () => {
      const rows = [record('f-1', 'প্রথম'), record('f-2', 'দ্বিতীয়'), record('f-3', 'তৃতীয়')];
      await store.load(async () => page(rows));

      expect(store.rows().map((row) => row.id)).toEqual(['f-1', 'f-2', 'f-3']);
      expect(store.hasPage()).toBe(true);
      expect(store.loading()).toBe(false);
    });

    it('keeps the page already on screen when a refresh fails, and marks it stale', async () => {
      await store.load(async () => page([record('f-1', 'প্রথম')]));
      await store.load(async () => {
        throw new Error('network');
      });

      expect(store.rows().map((row) => row.id)).toEqual(['f-1']);
      expect(store.stale()).toBe(true);
      expect(store.error()).not.toBeNull();
    });

    it('is not stale when it has never held a page — that is "not loaded", not "out of date"', async () => {
      await store.load(async () => {
        throw new Error('network');
      });

      expect(store.hasPage()).toBe(false);
      expect(store.stale()).toBe(false);
    });

    it('distinguishes an empty page from a page that never arrived', async () => {
      expect(store.countedEmpty()).toBe(false);
      await store.load(async () => page([]));
      expect(store.countedEmpty()).toBe(true);
    });
  });

  describe('the Idempotency-Key (WEB-API-004)', () => {
    it('returns the same key for every retry of one attempt', () => {
      const first = store.keyForAttempt();
      expect(store.keyForAttempt()).toBe(first);
      expect(store.keyForAttempt()).toBe(first);
    });

    it('mints a new key once the form content changes', () => {
      const first = store.keyForAttempt();
      store.contentChanged();
      expect(store.keyForAttempt()).not.toBe(first);
    });

    it('KEEPS the key after a failure, so a retry is the same attempt and not a second farmer', () => {
      const key = store.keyForAttempt();
      store.beginSubmit();
      store.submitFailed(PROBLEM);
      expect(store.keyForAttempt()).toBe(key);
    });

    it('retires the key after a success, so the next farmer starts a new attempt', () => {
      const key = store.keyForAttempt();
      store.beginSubmit();
      store.submitSucceeded(record('f-1', 'রহিম'), false);
      expect(store.keyForAttempt()).not.toBe(key);
    });

    it('does not reset a submit that is still in flight when content changes underneath it', () => {
      store.beginSubmit();
      store.contentChanged();
      expect(store.submitState()).toBe('submitting');
    });
  });

  describe('register outcome', () => {
    it('treats an idempotent replay as a success, not an error', () => {
      store.beginSubmit();
      store.submitSucceeded(record('f-1', 'রহিম'), true);

      expect(store.submitState()).toBe('succeeded');
      expect(store.outcome()?.replayed).toBe(true);
      expect(store.registerProblem()).toBeNull();
    });
  });

  describe('import', () => {
    it('holds per-row results even when every row failed — a partial result is still a result', () => {
      store.beginImport();
      store.importSucceeded({
        succeeded: 0,
        failed: 2,
        results: [
          { row: 2, status: 'FAILED', errorCode: 'ERR_PHONE_INVALID' },
          { row: 3, status: 'FAILED', errorCode: 'ERR_BULK_DUPLICATE' },
        ],
      });

      expect(store.importState()).toBe('succeeded');
      expect(store.importResults()?.results.length).toBe(2);
    });

    it('clears any previous result when a new import starts', () => {
      store.importSucceeded({ succeeded: 1, failed: 0, results: [{ row: 2, status: 'OK' }] });
      store.beginImport();
      expect(store.importResults()).toBeNull();
    });
  });
});
