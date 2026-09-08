import { TestBed } from '@angular/core/testing';
import { APP_CONFIG } from '../config/app-config';
import { ToastStore, TOAST_INFO, TOAST_SUCCESS } from './toast-store';

function store(): ToastStore {
  TestBed.configureTestingModule({});
  return TestBed.inject(ToastStore);
}

describe('ToastStore', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    TestBed.resetTestingModule();
  });

  it('queues toasts in arrival order', () => {
    const toasts = store();
    toasts.show({ kind: TOAST_INFO, titleKey: 'live.queue.updated' });
    toasts.show({ kind: TOAST_SUCCESS, titleKey: 'live.advisory.published', caseId: 'c-1' });

    expect(toasts.toasts().map((t) => t.titleKey)).toEqual([
      'live.queue.updated',
      'live.advisory.published',
    ]);
    expect(toasts.hasToasts()).toBe(true);
  });

  it('auto-dismisses after the configured lifetime', () => {
    const toasts = store();
    toasts.show({ kind: TOAST_INFO, titleKey: 'live.queue.updated' });

    vi.advanceTimersByTime(APP_CONFIG.ui.toastMs - 1);
    expect(toasts.toasts()).toHaveLength(1);

    vi.advanceTimersByTime(1);
    expect(toasts.toasts()).toHaveLength(0);
  });

  it('dismisses one toast without disturbing the others', () => {
    const toasts = store();
    const first = toasts.show({ kind: TOAST_INFO, titleKey: 'live.queue.updated' });
    toasts.show({ kind: TOAST_INFO, titleKey: 'live.stream.resynced' });

    toasts.dismiss(first);

    expect(toasts.toasts().map((t) => t.titleKey)).toEqual(['live.stream.resynced']);
  });

  it('carries a server-supplied title verbatim alongside a key-free toast', () => {
    const toasts = store();
    toasts.show({ kind: TOAST_SUCCESS, title: 'পরামর্শ প্রস্তুত', body: 'বিস্তারিত', caseId: 'c-1' });

    const toast = toasts.toasts()[0];
    expect(toast.title).toBe('পরামর্শ প্রস্তুত');
    expect(toast.titleKey).toBeUndefined();
    expect(toast.caseId).toBe('c-1');
  });

  it('cancels pending timers on sign-out so nothing fires into the next session', () => {
    const toasts = store();
    toasts.show({ kind: TOAST_INFO, titleKey: 'live.queue.updated' });

    toasts.clearSession();
    expect(toasts.toasts()).toHaveLength(0);

    vi.advanceTimersByTime(APP_CONFIG.ui.toastMs * 2);
    expect(toasts.toasts()).toHaveLength(0);
  });
});
