import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { APP_CONFIG, type Locale } from '../../../core/config/app-config';
import { LanguageStore } from '../../../core/i18n/language-store';

/**
 * WEB-UX-012 — switches every UI string with no page reload and WITHOUT LOSING UNSAVED FORM
 * STATE. That is why this only writes a signal in `LanguageStore`: nothing is navigated,
 * nothing is re-created, and a half-typed Bangla note on the capture screen survives the
 * toggle. A locale-per-build approach (`$localize`) could not do that, which is why
 * WEB-NFR-004 chose a runtime catalogue.
 *
 * WEB-UX-011 — Bangla is the default and the language of record, so it sits first.
 * WEB-UX-040 — two real `<button>`s in a labelled group: tab to the group, Tab between them,
 * Space or Enter to choose. `aria-pressed` states which is active, so the moving pill is
 * decoration rather than the only signal (WEB-UX-044).
 */
const LABEL_KEYS: Record<Locale, string> = { bn: 'app.language.bn', en: 'app.language.en' };

@Component({
  selector: 'foshol-lang-toggle',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  host: { class: 'inline-flex' },
  template: `
    <div
      class="inline-flex items-center gap-0.5 rounded-full p-0.5"
      [class]="trackClass()"
      role="group"
      [attr.aria-label]="'app.language.switch' | translate"
    >
      @for (locale of locales; track locale) {
        <button
          type="button"
          class="touch-target rounded-full px-3 text-sm font-semibold transition-colors duration-1 ease-settle"
          [class]="buttonClass(locale)"
          [attr.aria-pressed]="locale === active()"
          [attr.lang]="locale"
          (click)="choose(locale)"
        >
          {{ labelKey(locale) | translate }}
        </button>
      }
    </div>
  `,
})
export class LangToggle {
  private readonly language = inject(LanguageStore);

  /** The officer console runs on slate; the farmer surface runs on warm neutrals. */
  readonly tone = input<'light' | 'dark'>('light');

  protected readonly locales = APP_CONFIG.i18n.supportedLocales;
  protected readonly active = this.language.current;

  protected readonly trackClass = computed(() =>
    this.tone() === 'dark' ? 'bg-slate-900/60 ring-1 ring-slate-600' : 'bg-surface-2',
  );

  protected labelKey(locale: Locale): string {
    return LABEL_KEYS[locale];
  }

  protected buttonClass(locale: Locale): string {
    const selected = locale === this.active();
    if (this.tone() === 'dark') {
      return selected ? 'bg-slate-600 text-ink-invert' : 'text-surface-2 hover:bg-slate-700';
    }
    return selected ? 'bg-surface-0 text-ink shadow-stamp' : 'text-ink-muted hover:text-ink';
  }

  protected choose(locale: Locale): void {
    this.language.use(locale);
  }
}
