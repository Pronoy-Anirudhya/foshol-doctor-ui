import { APP_CONFIG } from '../config/app-config';

/**
 * WEB-DATA-006 / COMMON-NFR-011 — every instant crosses the API as UTC ISO-8601 and is
 * rendered in Asia/Dhaka. Time-zone conversion happens HERE and nowhere else in the system,
 * so there is exactly one place to be wrong.
 */
const ZONE = APP_CONFIG.i18n.displayZone;

const dateTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: ZONE, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
});
const dateOnly = new Intl.DateTimeFormat('en-GB', {
  timeZone: ZONE, day: '2-digit', month: 'short', year: 'numeric',
});
const timeOnly = new Intl.DateTimeFormat('en-GB', {
  timeZone: ZONE, hour: '2-digit', minute: '2-digit', hour12: false,
});

function parse(instant: string | Date | null | undefined): Date | null {
  if (instant == null) return null;
  const d = instant instanceof Date ? instant : new Date(instant);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDhakaDateTime(instant: string | Date | null | undefined): string {
  const d = parse(instant);
  return d ? `${dateTime.format(d)} (Dhaka)` : '';
}

export function formatDhakaDate(instant: string | Date | null | undefined): string {
  const d = parse(instant);
  return d ? dateOnly.format(d) : '';
}

export function formatDhakaTime(instant: string | Date | null | undefined): string {
  const d = parse(instant);
  return d ? timeOnly.format(d) : '';
}

/** Milliseconds from now until `instant`; negative once it has passed. */
export function msUntil(instant: string | Date | null | undefined, now = Date.now()): number {
  const d = parse(instant);
  return d ? d.getTime() - now : 0;
}
