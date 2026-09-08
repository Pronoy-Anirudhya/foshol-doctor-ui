import { Injectable } from '@angular/core';

/**
 * The only gateway to localStorage in the application.
 *
 * WEB-DATA-020 — only the language preference and the draft crop id + note text are ever
 * persisted, under the two keys named in APP_CONFIG.storageKeys.
 * WEB-DATA-021 — image bytes, audio bytes, a transcript, a phone number, an OTP code, a JWT,
 * a presigned URL, an advisory and any farmer or officer name are NEVER persisted. Case media
 * is farmer data guarded by a server-side ownership check; a copy in browser storage outlives
 * the session, escapes that check, and would still be on a shared demo laptop tomorrow.
 * WEB-DATA-024 — localStorage may be unavailable or may throw (private mode, disabled site
 * data, an embedded webview). Every access is guarded and the app renders correctly with no
 * stored value.
 */
@Injectable({ providedIn: 'root' })
export class LocalStore {
  read(key: string): string | null {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }

  readJson<T>(key: string, isValid: (value: unknown) => value is T): T | null {
    const raw = this.read(key);
    if (raw === null) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      return isValid(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  write(key: string, value: string): void {
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      /* Quota exceeded or storage disabled — a preference is not worth an error state. */
    }
  }

  writeJson(key: string, value: unknown): void {
    try {
      this.write(key, JSON.stringify(value));
    } catch {
      /* Unserialisable value — never let a persistence detail break a render. */
    }
  }

  remove(key: string): void {
    try {
      globalThis.localStorage?.removeItem(key);
    } catch {
      /* ignore */
    }
  }
}
