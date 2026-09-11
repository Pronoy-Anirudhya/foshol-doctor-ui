import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import {
  CaseImageContentService,
  type CaseImageVariant,
} from '../../../core/media/case-image-content.service';
import { CasePhoto, type PhotoSize } from './case-photo';

class FakeContent {
  readonly variants: CaseImageVariant[] = [];
  readonly revoked: string[] = [];
  failing = false;

  load(_caseId: string, _imageId: string, variant: CaseImageVariant): Promise<string> {
    this.variants.push(variant);
    return this.failing
      ? Promise.reject(new Error('unavailable'))
      : Promise.resolve(`blob:http://localhost:4200/photo-${this.variants.length}`);
  }

  revoke(url: string | null): void {
    if (url !== null) this.revoked.push(url);
  }
}

@Component({
  imports: [CasePhoto],
  template: `
    <foshol-case-photo
      caseId="c-1"
      imageId="i-1"
      alt="ধানের পাতা"
      [variant]="variant()"
      (naturalSize)="size = $event"
    />
  `,
})
class Host {
  readonly variant = signal<CaseImageVariant>('DERIVATIVE');
  size: PhotoSize | null = null;
}

describe('CasePhoto (WEB-FR-210, D-38)', () => {
  let content: FakeContent;

  const create = async (): Promise<ComponentFixture<Host>> => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    return fixture;
  };

  const image = (fixture: ComponentFixture<Host>): HTMLImageElement | null =>
    (fixture.nativeElement as HTMLElement).querySelector('img');

  beforeEach(() => {
    content = new FakeContent();
    TestBed.configureTestingModule({
      providers: [provideTranslateService(), { provide: CaseImageContentService, useValue: content }],
    });
  });

  it('binds a blob URL, asking for the derivative by default', async () => {
    const fixture = await create();

    expect(image(fixture)?.getAttribute('src')).toBe('blob:http://localhost:4200/photo-1');
    expect(image(fixture)?.getAttribute('alt')).toBe('ধানের পাতা');
    expect(content.variants).toEqual(['DERIVATIVE']);
  });

  it('asks for the original when told to', async () => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.variant.set('ORIGINAL');
    await fixture.whenStable();

    expect(content.variants).toEqual(['ORIGINAL']);
  });

  it('reports its natural size once loaded, for a caller lining up an overlay', async () => {
    const fixture = await create();
    const img = image(fixture)!;
    Object.defineProperty(img, 'naturalWidth', { value: 800 });
    Object.defineProperty(img, 'naturalHeight', { value: 600 });

    img.dispatchEvent(new Event('load'));
    await fixture.whenStable();

    expect(fixture.componentInstance.size).toEqual({ width: 800, height: 600 });
    const host = (fixture.nativeElement as HTMLElement).querySelector('foshol-case-photo');
    expect(host?.getAttribute('data-state')).toBe('ready');
  });

  /** Never the broken-image glyph: a line of text, and the alt text for AT. */
  it('falls back to text when the photograph cannot be fetched', async () => {
    content.failing = true;
    const fixture = await create();

    expect(image(fixture)).toBeNull();
    const fallback = (fixture.nativeElement as HTMLElement).querySelector('.fallback');
    expect(fallback?.textContent).toContain('media.image.unavailable');
  });

  it('fetches once more on a broken image, then falls back', async () => {
    const fixture = await create();

    image(fixture)!.dispatchEvent(new Event('error'));
    await fixture.whenStable();
    expect(content.variants.length).toBe(2);

    image(fixture)!.dispatchEvent(new Event('error'));
    await fixture.whenStable();
    expect(content.variants.length).toBe(2);
    expect((fixture.nativeElement as HTMLElement).querySelector('.fallback')).not.toBeNull();
  });

  it('revokes the object URL it holds when destroyed', async () => {
    const fixture = await create();
    fixture.destroy();

    expect(content.revoked).toEqual(['blob:http://localhost:4200/photo-1']);
  });
});
