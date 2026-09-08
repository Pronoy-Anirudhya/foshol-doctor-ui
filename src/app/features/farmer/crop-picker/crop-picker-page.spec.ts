import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { APP_CONFIG } from '../../../core/config/app-config';
import { provideI18n } from '../../../core/i18n/i18n.providers';
import { CaseDraftStore } from '../../../core/stores/case-draft-store';
import { ApiConfiguration } from '../../../generated/api-configuration';
import { KnowledgeService } from '../../../generated/services/knowledge.service';
import crops from '../../../../testing/fixtures/crops.json';
import { CropPickerPage } from './crop-picker-page';

/**
 * WEB-FR-100 / AC-02 — icon tiles, and no `<select>` in the rendered DOM.
 * WEB-FR-101 — while nothing is selected the forward control stays disabled.
 * WEB-UX-040 — one radiogroup, roving tabindex, arrow keys move and select.
 */
const CROPS_URL = `${APP_CONFIG.api.origin}${KnowledgeService.ListCropsPath}`;

describe('CropPickerPage (WEB-FR-100, WEB-FR-101)', () => {
  let fixture: ComponentFixture<CropPickerPage>;
  let http: HttpTestingController;
  let draft: CaseDraftStore;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideI18n(),
        { provide: ApiConfiguration, useValue: { rootUrl: APP_CONFIG.api.origin } },
      ],
    });

    http = TestBed.inject(HttpTestingController);
    draft = TestBed.inject(CaseDraftStore);
    draft.discard();

    fixture = TestBed.createComponent(CropPickerPage);
    fixture.detectChanges();
    http.expectOne(CROPS_URL).flush(crops);
    await fixture.whenStable();
  });

  afterEach(() => {
    http.verify();
  });

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function tiles(): HTMLButtonElement[] {
    return [...el().querySelectorAll<HTMLButtonElement>('[data-testid="crop-tile"]')];
  }

  it('renders one large tile per crop and no dropdown (AC-02)', () => {
    expect(tiles().length).toBe(crops.length);
    expect(el().querySelector('select')).toBeNull();
    for (const tile of tiles()) {
      expect(tile.getAttribute('role')).toBe('radio');
      expect(tile.querySelector('svg')).not.toBeNull();
    }
  });

  it('keeps the capture step disabled while no crop is selected (WEB-FR-101)', () => {
    const forward = el().querySelector<HTMLButtonElement>('[data-testid="crop-continue"]');
    expect(forward?.disabled).toBe(true);
    expect(el().querySelector('[data-testid="crop-required"]')).not.toBeNull();
  });

  it('marks selection with a ring, a tick AND aria-checked — never colour alone', async () => {
    tiles()[1]!.click();
    await fixture.whenStable();

    const selected = tiles()[1]!;
    expect(selected.getAttribute('aria-checked')).toBe('true');
    expect(selected.dataset['selected']).toBe('true');
    // The tick is a second, non-colour carrier of the same fact (WEB-UX-044).
    expect(selected.querySelector('.crop-tick')).not.toBeNull();
    expect(draft.cropId()).toBe(crops[1]!.id);
    expect(el().querySelector<HTMLButtonElement>('[data-testid="crop-continue"]')?.disabled).toBe(
      false,
    );
  });

  it('moves and selects with the arrow keys, wrapping at the ends (WEB-UX-040)', async () => {
    const group = el().querySelector('[role="radiogroup"]')!;

    group.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await fixture.whenStable();
    expect(draft.cropId()).toBe(crops[1]!.id);

    group.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    await fixture.whenStable();
    expect(draft.cropId()).toBe(crops[0]!.id);

    group.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    await fixture.whenStable();
    expect(draft.cropId()).toBe(crops[crops.length - 1]!.id);
  });

  it('keeps the group to one tab stop with a roving tabindex', async () => {
    tiles()[2]!.click();
    await fixture.whenStable();

    expect(tiles().map((tile) => tile.getAttribute('tabindex'))).toEqual(['-1', '-1', '0']);
  });
});
