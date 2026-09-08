import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { SecureMediaService } from '../../../core/media/secure-media.service';
import { SecureImage } from './secure-image';

const FIRST_URL = 'https://store.example/one.jpg?X-Amz-Signature=a';
const SECOND_URL = 'https://store.example/one.jpg?X-Amz-Signature=b';
const ALT = 'ধানের পাতায় দাগ';

class FakeSecureMediaService {
  resolveCalls = 0;
  refreshCalls = 0;
  resolved: string | Promise<string> = FIRST_URL;
  refreshed: string | Promise<string> = SECOND_URL;

  resolve(): Promise<string> {
    this.resolveCalls += 1;
    return Promise.resolve(this.resolved);
  }

  refresh(): Promise<string> {
    this.refreshCalls += 1;
    return Promise.resolve(this.refreshed);
  }
}

@Component({
  imports: [SecureImage],
  template: `<foshol-secure-image caseId="c-1" imageId="i-1" [alt]="alt" />`,
})
class Host {
  readonly alt = ALT;
}

describe('SecureImage', () => {
  let media: FakeSecureMediaService;

  const create = async (): Promise<ReturnType<typeof TestBed.createComponent<Host>>> => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    return fixture;
  };

  const img = (fixture: { nativeElement: HTMLElement }): HTMLImageElement | null =>
    fixture.nativeElement.querySelector('img');

  beforeEach(() => {
    media = new FakeSecureMediaService();
    TestBed.configureTestingModule({
      providers: [provideTranslateService(), { provide: SecureMediaService, useValue: media }],
    });
  });

  /** WEB-FR-400 — a skeleton occupies the region before anything has loaded. */
  it('renders a skeleton rather than a blank region', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.skeleton')).not.toBeNull();
  });

  /** WEB-FR-154 — the src is the presigned URL the API returned, never a constructed path. */
  it('binds the presigned URL the service resolved', async () => {
    const fixture = await create();
    expect(img(fixture)?.getAttribute('src')).toBe(FIRST_URL);
  });

  /** WEB-UX-042 — the required alt reaches the element verbatim. */
  it('carries the caller-supplied alternative text', async () => {
    const fixture = await create();
    expect(img(fixture)?.getAttribute('alt')).toBe(ALT);
  });

  it('lazy-loads and decodes asynchronously', async () => {
    const fixture = await create();
    expect(img(fixture)?.getAttribute('loading')).toBe('lazy');
    expect(img(fixture)?.getAttribute('decoding')).toBe('async');
  });

  /**
   * WEB-SEC-003 — no `crossorigin` attribute, so this stays a plain no-CORS subresource load
   * and no header of ours travels to the object store.
   */
  it('does not set crossorigin on the image element', async () => {
    const fixture = await create();
    expect(img(fixture)?.hasAttribute('crossorigin')).toBe(false);
  });

  it('forces exactly one presign refresh when the image element errors', async () => {
    const fixture = await create();

    img(fixture)?.dispatchEvent(new Event('error'));
    await fixture.whenStable();

    expect(media.refreshCalls).toBe(1);
    expect(img(fixture)?.getAttribute('src')).toBe(SECOND_URL);
  });

  /** Never the browser's broken-image glyph — a text placeholder instead. */
  it('falls back to text after the second failure, and stops retrying', async () => {
    const fixture = await create();

    img(fixture)?.dispatchEvent(new Event('error'));
    await fixture.whenStable();
    img(fixture)?.dispatchEvent(new Event('error'));
    await fixture.whenStable();

    expect(media.refreshCalls).toBe(1);
    expect(img(fixture)).toBeNull();
    expect(fixture.nativeElement.querySelector('.fallback')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain(ALT);
  });

  it('falls back to text when the presign itself fails', async () => {
    media.resolve = (): Promise<string> => Promise.reject(new Error('presign failed'));

    const fixture = await create();

    expect(img(fixture)).toBeNull();
    expect(fixture.nativeElement.querySelector('.fallback')).not.toBeNull();
  });
});
