import { computed, effect, inject, Injectable, signal } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { APP_CONFIG, type Locale } from '../config/app-config';
import { LocalStore } from '../storage/local-store';

const isLocale = (v: unknown): v is Locale =>
  typeof v === 'string' && (APP_CONFIG.i18n.supportedLocales as readonly string[]).includes(v);

/**
 * WEB-UX-011 — Bangla is the default and the language of record (COMMON-NFR-037).
 * WEB-UX-012 — the toggle switches every UI string with no page reload and without losing
 * unsaved form state, which is why the catalogue swaps at runtime rather than the app being
 * rebuilt per locale (WEB-NFR-004).
 * WEB-DATA-020 — the preference is the one non-sensitive thing worth persisting: a judge
 * should not have to re-toggle after a refresh.
 */
@Injectable({ providedIn: 'root' })
export class LanguageStore {
  private readonly storage = inject(LocalStore);
  private readonly translate = inject(TranslateService);

  private readonly _current = signal<Locale>(this.restore());

  readonly current = this._current.asReadonly();
  readonly isBangla = computed(() => this._current() === 'bn');
  /** The other locale — what the toggle switches to. */
  readonly alternate = computed<Locale>(() => (this._current() === 'bn' ? 'en' : 'bn'));

  constructor() {
    effect(() => {
      const locale = this._current();
      this.translate.use(locale);
      // WEB-UX-045 — the document root carries the active locale, and updates on toggle.
      document.documentElement.lang = locale;
      this.storage.write(APP_CONFIG.storageKeys.lang, locale);
    });
  }

  use(locale: Locale): void {
    this._current.set(locale);
  }

  toggle(): void {
    this._current.set(this.alternate());
  }

  private restore(): Locale {
    const stored = this.storage.read(APP_CONFIG.storageKeys.lang);
    return isLocale(stored) ? stored : APP_CONFIG.i18n.defaultLocale;
  }
}
