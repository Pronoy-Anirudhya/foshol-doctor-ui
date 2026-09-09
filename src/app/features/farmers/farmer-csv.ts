import { APP_CONFIG } from '../../core/config/app-config';

/**
 * Pure helpers for the bulk-import screen. No Angular, no HTTP, no DOM — so each one is
 * testable on its own, which matters because every rule here has a server counterpart and the
 * two must be seen to agree.
 *
 * **None of this validates the CSV.** The server does that, per row, and its answer is the one
 * of record (`WEB-NFR-010`). These checks exist only so an officer standing in a field learns
 * that they picked the wrong file *before* spending a request and a wait on it — exactly the
 * role `review.bulkMaxSize` already plays for bulk reject.
 */

/** U+FEFF. Written as an escape rather than the literal so it survives any editor. */
const BOM = '﻿';

export type CsvRejection = 'TOO_LARGE' | 'TOO_MANY_ROWS' | 'BAD_HEADER' | 'EMPTY';

export interface CsvCheck {
  readonly rejection: CsvRejection | null;
  /** Data rows, header excluded. `0` when the file has a header and nothing else. */
  readonly dataRows: number;
}

/**
 * The template, ready to hand to the browser as a download.
 *
 * The server already sends a BOM (`IDENTITY-FR-024`), but the generated operation is declared
 * `type: string` rather than `format: binary`, so it arrives as text and we rebuild the file.
 * Stripping any leading BOM before prepending one is what stops a round-trip through this
 * function from producing `﻿﻿…`, which Excel renders as a stray glyph in the first
 * column heading — the exact failure the BOM is there to prevent.
 */
export function templateBlob(csv: string): Blob {
  const withoutBom = csv.startsWith(BOM) ? csv.slice(BOM.length) : csv;
  return new Blob([`${BOM}${withoutBom}`], { type: 'text/csv;charset=utf-8' });
}

/** Normalises CRLF and a trailing newline away, then splits. Blank lines are not rows. */
function contentLines(text: string): readonly string[] {
  const withoutBom = text.startsWith(BOM) ? text.slice(BOM.length) : text;
  return withoutBom
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * Checks a chosen file's text against the three things we can know without asking the server.
 *
 * The header comparison is exact and case-sensitive against `APP_CONFIG.farmers.templateHeader`.
 * That is the point of `WEB-FR-313`'s "SHALL NOT invent extra CSV columns": a file with a sixth
 * column is not a file we may guess about.
 */
export function checkCsv(text: string, sizeBytes: number): CsvCheck {
  if (sizeBytes > APP_CONFIG.farmers.importMaxBytes) return { rejection: 'TOO_LARGE', dataRows: 0 };

  const lines = contentLines(text);
  if (lines.length === 0) return { rejection: 'EMPTY', dataRows: 0 };

  const [header, ...rows] = lines;
  if (header !== APP_CONFIG.farmers.templateHeader) return { rejection: 'BAD_HEADER', dataRows: 0 };
  if (rows.length === 0) return { rejection: 'EMPTY', dataRows: 0 };
  if (rows.length > APP_CONFIG.farmers.importMaxRows) {
    return { rejection: 'TOO_MANY_ROWS', dataRows: rows.length };
  }

  return { rejection: null, dataRows: rows.length };
}
