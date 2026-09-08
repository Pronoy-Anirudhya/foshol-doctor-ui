import { TestBed } from '@angular/core/testing';
import { LiveAnnouncer } from './live-announcer';

function store(): LiveAnnouncer {
  TestBed.configureTestingModule({});
  return TestBed.inject(LiveAnnouncer);
}

describe('LiveAnnouncer (WEB-UX-046)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('starts with nothing to announce', () => {
    expect(store().message()).toBeNull();
  });

  it('holds a translation key rather than translated text', () => {
    const announcer = store();
    announcer.announce('live.case.statusChanged');

    expect(announcer.message()?.key).toBe('live.case.statusChanged');
  });

  it('changes the signal even when the same key is announced twice', () => {
    const announcer = store();
    announcer.announce('live.queue.updated');
    const first = announcer.message();
    announcer.announce('live.queue.updated');

    expect(announcer.message()).not.toBe(first);
    expect(announcer.message()?.seq).toBe((first?.seq ?? 0) + 1);
  });

  it('carries interpolation params through unchanged', () => {
    const announcer = store();
    announcer.announce('live.draft.imageLimit', { max: 3 });

    expect(announcer.message()?.params).toEqual({ max: 3 });
  });

  it('clears on sign-out', () => {
    const announcer = store();
    announcer.announce('live.queue.updated');
    announcer.clearSession();

    expect(announcer.message()).toBeNull();
  });
});
