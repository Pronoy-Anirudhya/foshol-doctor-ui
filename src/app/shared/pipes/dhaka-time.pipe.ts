import { Pipe, type PipeTransform } from '@angular/core';
import { formatDhakaTime } from '../../core/time/dhaka-time';

/** WEB-DATA-006 — see `dhaka-date.pipe.ts`; the zone conversion is not repeated here. */
@Pipe({ name: 'dhakaTime' })
export class DhakaTimePipe implements PipeTransform {
  transform(value: string | Date | null | undefined): string {
    return formatDhakaTime(value);
  }
}
