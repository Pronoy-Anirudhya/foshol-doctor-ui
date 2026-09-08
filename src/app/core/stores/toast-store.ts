import { computed, Injectable, signal } from '@angular/core';
import { APP_CONFIG } from '../config/app-config';
import { newUuid } from '../util/uuid';

/**
 * WEB-FR-354 — the in-app toast an advisory event raises.
 *
 * A toast carries EITHER a translation key (chrome this application authored) or a literal
 * `title` / `body` (a string the server sent). The two are separate fields on purpose: a
 * server-supplied Bangla advisory title must never be looked up in a catalogue, and chrome must
 * never be shipped as a literal (WEB-UX-013, COMMON-CON-003). Both render as text, never as
 * HTML (WEB-SEC-005).
 */
export type ToastKind = 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR';

export const TOAST_INFO: ToastKind = 'INFO';
export const TOAST_SUCCESS: ToastKind = 'SUCCESS';
export const TOAST_WARNING: ToastKind = 'WARNING';
export const TOAST_ERROR: ToastKind = 'ERROR';

export interface Toast {
  readonly id: string;
  readonly kind: ToastKind;
  /** A key from this application's catalogues. Mutually exclusive with `title` in practice. */
  readonly titleKey?: string;
  /** A string the server supplied; rendered verbatim and never translated. */
  readonly title?: string;
  readonly body?: string;
  /** WEB-FR-354 — lets the toast offer "open the case" without the view guessing. */
  readonly caseId?: string;
}

export type ToastInput = Omit<Toast, 'id'>;

@Injectable({ providedIn: 'root' })
export class ToastStore {
  private readonly _toasts = signal<readonly Toast[]>([]);
  readonly toasts = this._toasts.asReadonly();
  readonly hasToasts = computed(() => this._toasts().length > 0);

  readonly #timers = new Map<string, ReturnType<typeof setTimeout>>();

  show(input: ToastInput): string {
    const id = newUuid();
    const toast: Toast = { ...input, id };
    this._toasts.update((current) => [...current, toast]);
    // setTimeout, not setInterval: this is a one-shot dismissal, not a poll (WEB-FR-356).
    this.#timers.set(
      id,
      setTimeout(() => this.dismiss(id), APP_CONFIG.ui.toastMs),
    );
    return id;
  }

  dismiss(id: string): void {
    const timer = this.#timers.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.#timers.delete(id);
    }
    this._toasts.update((current) => current.filter((toast) => toast.id !== id));
  }

  dismissAll(): void {
    for (const timer of this.#timers.values()) clearTimeout(timer);
    this.#timers.clear();
    this._toasts.set([]);
  }

  /** WEB-SEC-004 — a pending toast about one session's case must not outlive it. */
  clearSession(): void {
    this.dismissAll();
  }
}
