import { TestBed } from '@angular/core/testing';
import { APP_CONFIG } from '../config/app-config';
import { CaseDraftStore, IMAGE_LIMIT_KEY, type DraftImage } from './case-draft-store';

/** jsdom does not always define the object-URL helpers; the store guards the call anyway. */
function spyRevoke() {
  const target = URL as unknown as Record<string, unknown>;
  if (typeof target['revokeObjectURL'] !== 'function') target['revokeObjectURL'] = (): void => undefined;
  return vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
}

/**
 * An in-memory Storage. The ambient one in this runner is not a complete Storage, and these
 * tests are about what LocalStore writes rather than about the runner's shims.
 */
class MemoryStorage {
  readonly #map = new Map<string, string>();
  get length(): number {
    return this.#map.size;
  }
  key(index: number): string | null {
    return [...this.#map.keys()][index] ?? null;
  }
  getItem(key: string): string | null {
    return this.#map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.#map.set(key, value);
  }
  removeItem(key: string): void {
    this.#map.delete(key);
  }
  clear(): void {
    this.#map.clear();
  }
}

let storage: MemoryStorage;
let originalStorage: PropertyDescriptor | undefined;

const image = (id: string): DraftImage => ({
  id,
  blob: new Blob([id]),
  previewUrl: `blob:preview-${id}`,
  width: 1600,
  height: 1200,
  metrics: {},
});

function store(): CaseDraftStore {
  TestBed.configureTestingModule({});
  return TestBed.inject(CaseDraftStore);
}

describe('CaseDraftStore', () => {
  beforeEach(() => {
    storage = new MemoryStorage();
    originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
  });

  // WEB-DATA-004 / WEB-TEST-004 — the image count cap.
  it('refuses a fourth image with a message rather than discarding one', () => {
    const draft = store();
    for (let i = 0; i < APP_CONFIG.intake.maxImages; i++) {
      expect(draft.addImage(image(`i-${i}`))).toBe(true);
    }

    expect(draft.addImage(image('overflow'))).toBe(false);
    expect(draft.imageCount()).toBe(APP_CONFIG.intake.maxImages);
    expect(draft.images().map((img) => img.id)).toEqual(['i-0', 'i-1', 'i-2']);
    expect(draft.refusalKey()).toBe(IMAGE_LIMIT_KEY);
    expect(draft.isFull()).toBe(true);
  });

  it('enables submit only between min and max images with a crop chosen', () => {
    const draft = store();
    expect(draft.canSubmit()).toBe(false);

    draft.chooseCrop('crop-1');
    expect(draft.canSubmit()).toBe(false);

    draft.addImage(image('i-0'));
    expect(draft.canSubmit()).toBe(true);

    draft.beginSubmit();
    expect(draft.canSubmit()).toBe(false);
  });

  // WEB-DATA-005 / AC-28 — one key per attempt, reused on retry, new only on content change.
  it('reuses the idempotency key across retries of the same attempt', () => {
    const draft = store();
    draft.chooseCrop('crop-1');
    draft.addImage(image('i-0'));

    const first = draft.keyForAttempt();
    draft.beginSubmit();
    draft.failSubmit();
    const retry = draft.keyForAttempt();

    expect(retry).toBe(first);
    expect(draft.canRetry()).toBe(true);
  });

  it('regenerates the idempotency key when the crop, images, audio or note change', () => {
    const draft = store();
    draft.chooseCrop('crop-1');
    draft.addImage(image('i-0'));

    const before = draft.keyForAttempt();

    draft.setNote('নতুন নোট');
    const afterNote = draft.keyForAttempt();
    expect(afterNote).not.toBe(before);

    draft.addImage(image('i-1'));
    const afterImage = draft.keyForAttempt();
    expect(afterImage).not.toBe(afterNote);

    draft.setAudio({ blob: new Blob(['a']), durationMs: 1200, mimeType: 'audio/webm' });
    expect(draft.keyForAttempt()).not.toBe(afterImage);
  });

  it('does not regenerate the key merely because it was asked for twice', () => {
    const draft = store();
    draft.chooseCrop('crop-1');
    expect(draft.keyForAttempt()).toBe(draft.keyForAttempt());
  });

  // WEB-DATA-020 / WEB-DATA-021 — only the crop id and the note are ever persisted.
  it('persists only the crop id and the note text', () => {
    const draft = store();
    draft.chooseCrop('crop-1');
    draft.setNote('পাতায় দাগ');
    draft.addImage(image('i-0'));
    draft.setAudio({ blob: new Blob(['a']), durationMs: 900, mimeType: 'audio/webm' });

    TestBed.tick();
    const raw = storage.getItem(APP_CONFIG.storageKeys.draft) ?? '';
    expect(JSON.parse(raw)).toEqual({ cropId: 'crop-1', noteBn: 'পাতায় দাগ' });
    expect(raw).not.toContain('blob:');
    expect(raw).not.toContain('audio');
  });

  it('restores the persisted crop and note into a new store instance', () => {
    storage.setItem(
      APP_CONFIG.storageKeys.draft,
      JSON.stringify({ cropId: 'crop-7', noteBn: 'আগের নোট' }),
    );

    const draft = store();
    expect(draft.cropId()).toBe('crop-7');
    expect(draft.noteBn()).toBe('আগের নোট');
    expect(draft.images()).toHaveLength(0);
  });

  it('ignores a malformed persisted draft (WEB-DATA-024)', () => {
    storage.setItem(APP_CONFIG.storageKeys.draft, '{ not json');
    const draft = store();
    expect(draft.cropId()).toBeNull();
  });

  // WEB-DATA-022 — a successful submit clears the persisted draft and revokes every preview.
  it('revokes preview object URLs and clears storage on a successful submit', () => {
    const revoke = spyRevoke();
    const draft = store();
    draft.chooseCrop('crop-1');
    draft.setNote('নোট');
    draft.addImage(image('i-0'));
    draft.addImage(image('i-1'));

    draft.completeSubmit();

    expect(revoke).toHaveBeenCalledWith('blob:preview-i-0');
    expect(revoke).toHaveBeenCalledWith('blob:preview-i-1');
    expect(draft.images()).toHaveLength(0);
    expect(draft.cropId()).toBeNull();
    expect(draft.idempotencyKey()).toBeNull();
    expect(storage.getItem(APP_CONFIG.storageKeys.draft)).toBeNull();
    revoke.mockRestore();
  });

  it('revokes a preview when a single image is removed', () => {
    const revoke = spyRevoke();
    const draft = store();
    draft.addImage(image('i-0'));
    draft.removeImage('i-0');

    expect(revoke).toHaveBeenCalledWith('blob:preview-i-0');
    expect(draft.images()).toHaveLength(0);
    revoke.mockRestore();
  });

  it('truncates a note to the contract maximum', () => {
    const draft = store();
    draft.setNote('x'.repeat(APP_CONFIG.intake.noteMaxLength + 100));
    expect(draft.noteBn()).toHaveLength(APP_CONFIG.intake.noteMaxLength);
  });

  // WEB-SEC-004 / WEB-DATA-023 — session clearing.
  it('clears media, the key and the persisted draft on sign-out', () => {
    const revoke = spyRevoke();
    const draft = store();
    draft.chooseCrop('crop-1');
    draft.addImage(image('i-0'));
    draft.keyForAttempt();

    draft.clearSession();

    expect(draft.images()).toHaveLength(0);
    expect(draft.cropId()).toBeNull();
    expect(draft.noteBn()).toBe('');
    expect(draft.idempotencyKey()).toBeNull();
    expect(storage.getItem(APP_CONFIG.storageKeys.draft)).toBeNull();
    revoke.mockRestore();
  });
});
