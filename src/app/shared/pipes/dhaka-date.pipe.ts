import { Pipe, type PipeTransform } from '@angular/core';
import { formatDhakaDate } from '../../core/time/dhaka-time';

/**
 * WEB-DATA-006 — every instant crosses the API as UTC and renders in Asia/Dhaka. The
 * conversion lives in `core/time/dhaka-time` and NOWHERE else, so this pipe delegates and
 * deliberately performs no date arithmetic of its own.
 */
@Pipe({ name: 'dhakaDate' })
export class DhakaDatePipe implements PipeTransform {
  transform(value: string | Date | null | undefined): string {
    return formatDhakaDate(value);
  }
}
