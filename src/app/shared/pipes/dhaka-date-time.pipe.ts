import { Pipe, type PipeTransform } from '@angular/core';
import { formatDhakaDateTime } from '../../core/time/dhaka-time';

/**
 * WEB-DATA-006 — the full form, which carries its own "(Dhaka)" suffix so a timestamp on
 * screen can never be mistaken for the reader's own local time.
 */
@Pipe({ name: 'dhakaDateTime' })
export class DhakaDateTimePipe implements PipeTransform {
  transform(value: string | Date | null | undefined): string {
    return formatDhakaDateTime(value);
  }
}
