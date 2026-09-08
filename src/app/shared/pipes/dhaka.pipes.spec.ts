import { DhakaDatePipe } from './dhaka-date.pipe';
import { DhakaDateTimePipe } from './dhaka-date-time.pipe';
import { DhakaTimePipe } from './dhaka-time.pipe';

/**
 * WEB-DATA-006 — every instant crosses the API as UTC and is rendered in Asia/Dhaka (UTC+6).
 * These tests assert the offset is actually applied, which is the only way to notice that a
 * pipe has quietly started doing its own date arithmetic instead of delegating.
 */
describe('Dhaka time pipes (WEB-DATA-006)', () => {
  // 2025-03-14T20:30:00Z is 15 March, 02:30 in Dhaka — a different DAY as well as a
  // different hour, so a pipe rendering UTC fails on both counts.
  const instant = '2025-03-14T20:30:00Z';

  it('shifts the date across midnight into Dhaka', () => {
    expect(new DhakaDatePipe().transform(instant)).toBe('15 Mar 2025');
  });

  it('renders the Dhaka wall-clock time in 24-hour form', () => {
    expect(new DhakaTimePipe().transform(instant)).toBe('02:30');
  });

  it('names the zone in the combined form, so a timestamp cannot be read as local', () => {
    expect(new DhakaDateTimePipe().transform(instant)).toBe('15 Mar 2025, 02:30 (Dhaka)');
  });

  it('renders an empty string for an absent or unparseable instant', () => {
    for (const pipe of [new DhakaDatePipe(), new DhakaTimePipe(), new DhakaDateTimePipe()]) {
      expect(pipe.transform(null)).toBe('');
      expect(pipe.transform(undefined)).toBe('');
      expect(pipe.transform('not a date')).toBe('');
    }
  });
});
