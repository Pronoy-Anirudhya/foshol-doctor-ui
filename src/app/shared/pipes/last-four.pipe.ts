import { Pipe, type PipeTransform } from '@angular/core';
import { SessionStore } from '../../core/auth/session-store';

/**
 * WEB-SEC-006 — after authentication a phone number is displayed only as its last four
 * digits. The masking itself is `SessionStore.maskPhone`, so there is exactly one definition
 * of "masked" in the application and `auth.phoneVisibleDigits` is honoured everywhere.
 */
@Pipe({ name: 'lastFour' })
export class LastFourPipe implements PipeTransform {
  transform(phone: string | null | undefined): string {
    return SessionStore.maskPhone(phone);
  }
}
