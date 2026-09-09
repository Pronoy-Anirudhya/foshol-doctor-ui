import { APP_CONFIG } from '../../core/config/app-config';
import { checkCsv, templateBlob } from './farmer-csv';

const BOM = '﻿';
const HEADER = APP_CONFIG.farmers.templateHeader;
const ROW = 'রহিম উদ্দিন,+8801712345678,30,3026,bn';

/** Small enough to never trip the byte cap; the size checks pass it explicitly. */
const TINY = 64;

describe('farmer-csv', () => {
  /**
   * Asserted on BYTES, never through `Blob.text()`: that decodes as UTF-8 and the decoding
   * algorithm strips a leading BOM, so a text read cannot tell a file with a BOM from one
   * without. The bytes are the whole point here, so the bytes are what is checked.
   */
  async function bytesOf(blob: Blob): Promise<Uint8Array> {
    return new Uint8Array(await blob.arrayBuffer());
  }

  const BOM_BYTES = [0xef, 0xbb, 0xbf];

  describe('templateBlob', () => {
    it('prepends a BOM so Excel reads the Bangla column values as UTF-8', async () => {
      const bytes = await bytesOf(templateBlob(HEADER));
      expect([...bytes.slice(0, BOM_BYTES.length)]).toEqual(BOM_BYTES);
    });

    it('does not double the BOM when the server already sent one', async () => {
      const once = await bytesOf(templateBlob(HEADER));
      const twice = await bytesOf(templateBlob(`${BOM}${HEADER}`));
      // Byte-identical to the no-BOM input: the second one was stripped before being re-added.
      expect([...twice]).toEqual([...once]);
      expect([...twice.slice(0, 6)]).not.toEqual([...BOM_BYTES, ...BOM_BYTES]);
    });

    it('declares UTF-8 on the blob itself', () => {
      expect(templateBlob(HEADER).type).toBe('text/csv;charset=utf-8');
    });
  });

  describe('checkCsv', () => {
    it('accepts the template header followed by data rows', () => {
      expect(checkCsv(`${HEADER}\n${ROW}\n${ROW}`, TINY)).toEqual({ rejection: null, dataRows: 2 });
    });

    it('tolerates a BOM, CRLF line endings and a trailing newline', () => {
      expect(checkCsv(`${BOM}${HEADER}\r\n${ROW}\r\n`, TINY)).toEqual({
        rejection: null,
        dataRows: 1,
      });
    });

    it('rejects a header that is not exactly the template — no invented columns', () => {
      const extra = checkCsv(`${HEADER},village\n${ROW},Shibpur`, TINY);
      expect(extra.rejection).toBe('BAD_HEADER');

      const reordered = checkCsv(`phone,name,divisionCode,districtCode,preferredLanguage`, TINY);
      expect(reordered.rejection).toBe('BAD_HEADER');
    });

    it('rejects a file with a header but no data rows', () => {
      expect(checkCsv(HEADER, TINY).rejection).toBe('EMPTY');
      expect(checkCsv('', TINY).rejection).toBe('EMPTY');
    });

    it('rejects more data rows than the server would accept, and reports how many there were', () => {
      const rows = Array.from({ length: APP_CONFIG.farmers.importMaxRows + 1 }, () => ROW);
      const result = checkCsv(`${HEADER}\n${rows.join('\n')}`, TINY);
      expect(result.rejection).toBe('TOO_MANY_ROWS');
      expect(result.dataRows).toBe(APP_CONFIG.farmers.importMaxRows + 1);
    });

    it('accepts exactly the maximum number of rows — the cap is inclusive', () => {
      const rows = Array.from({ length: APP_CONFIG.farmers.importMaxRows }, () => ROW);
      expect(checkCsv(`${HEADER}\n${rows.join('\n')}`, TINY).rejection).toBeNull();
    });

    it('rejects on size before anything else, since an oversized file is refused regardless', () => {
      const oversize = APP_CONFIG.farmers.importMaxBytes + 1;
      expect(checkCsv(`${HEADER}\n${ROW}`, oversize).rejection).toBe('TOO_LARGE');
    });
  });
});
