import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { ImageZoom } from './image-zoom';

/**
 * WEB-FR-210 / WEB-UX-040 — the keyboard half of the zoom is the half that normally goes
 * missing, so it is the half that is tested. Every assertion below is reachable without a
 * pointer.
 */

const VIEWPORT_PX = 400;

describe('ImageZoom', () => {
  const create = () => {
    const fixture = TestBed.createComponent(ImageZoom);
    fixture.detectChanges();
    return fixture;
  };

  type Fixture = ReturnType<typeof create>;

  const host = (fixture: Fixture): HTMLElement => fixture.nativeElement as HTMLElement;

  const viewport = (fixture: Fixture): HTMLElement => {
    const element = host(fixture).querySelector<HTMLElement>('.viewport');
    if (element === null) throw new Error('viewport missing');
    return element;
  };

  const press = (fixture: Fixture, key: string): void => {
    viewport(fixture).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    fixture.detectChanges();
  };

  const transform = (fixture: Fixture): string =>
    host(fixture).querySelector<HTMLElement>('.layer')?.style.transform ?? '';

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideTranslateService()] });
  });

  it('starts at fit', () => {
    expect(transform(create())).toContain('scale(1)');
  });

  it('zooms in and out from the keyboard', () => {
    const fixture = create();

    press(fixture, '+');
    expect(transform(fixture)).toContain('scale(1.5)');

    press(fixture, '-');
    expect(transform(fixture)).toContain('scale(1)');
  });

  it('accepts = as zoom in, since + needs shift on most layouts', () => {
    const fixture = create();
    press(fixture, '=');
    expect(transform(fixture)).toContain('scale(1.5)');
  });

  it('returns to fit on 0', () => {
    const fixture = create();
    press(fixture, '+');
    press(fixture, '+');
    press(fixture, '0');
    expect(transform(fixture)).toContain('scale(1)');
  });

  it('never zooms out below fit', () => {
    const fixture = create();
    press(fixture, '-');
    press(fixture, '-');
    expect(transform(fixture)).toContain('scale(1)');
  });

  it('pans with the arrow keys once zoomed', () => {
    const fixture = create();
    const element = viewport(fixture);
    // jsdom has no layout engine, so the pan bound would otherwise always be zero.
    element.getBoundingClientRect = (): DOMRect =>
      ({ width: VIEWPORT_PX, height: VIEWPORT_PX }) as DOMRect;

    press(fixture, '+');
    press(fixture, 'ArrowRight');

    expect(transform(fixture)).toContain('translate(-48px, 0px)');
  });

  /** At fit there is nothing to pan, and swallowing an arrow key would break page scrolling. */
  it('leaves the arrow keys to the page while at fit', () => {
    const fixture = create();
    const event = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      bubbles: true,
      cancelable: true,
    });
    viewport(fixture).dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it('clamps the pan to the image edge', () => {
    const fixture = create();
    const element = viewport(fixture);
    element.getBoundingClientRect = (): DOMRect =>
      ({ width: VIEWPORT_PX, height: VIEWPORT_PX }) as DOMRect;

    press(fixture, '+');
    for (let i = 0; i < 20; i += 1) press(fixture, 'ArrowRight');

    // scale 1.5 over a 400px frame allows 400 * 0.5 / 2 = 100px of travel.
    expect(transform(fixture)).toContain('translate(-100px, 0px)');
  });

  /** WEB-UX-031 — plain wheel scrolling belongs to the page; only ctrl+wheel zooms. */
  it('ignores a wheel event without ctrl', () => {
    const fixture = create();
    const event = new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true });
    viewport(fixture).dispatchEvent(event);
    fixture.detectChanges();

    expect(event.defaultPrevented).toBe(false);
    expect(transform(fixture)).toContain('scale(1)');
  });

  it('zooms on ctrl+wheel', () => {
    const fixture = create();
    const event = new WheelEvent('wheel', {
      deltaY: -100,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    viewport(fixture).dispatchEvent(event);
    fixture.detectChanges();

    expect(event.defaultPrevented).toBe(true);
    expect(transform(fixture)).not.toContain('scale(1)');
  });

  it('toggles between fit and a working magnification on double-click', () => {
    const fixture = create();

    viewport(fixture).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    fixture.detectChanges();
    expect(transform(fixture)).toContain('scale(2.5)');

    viewport(fixture).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    fixture.detectChanges();
    expect(transform(fixture)).toContain('scale(1)');
  });

  /** WEB-UX-031 — a full-width image at 360px must not become a dead zone for page scrolling. */
  it('releases touch-action back to the page while at fit', () => {
    const fixture = create();
    expect(viewport(fixture).style.touchAction).toBe('pan-y');

    press(fixture, '+');
    expect(viewport(fixture).style.touchAction).toBe('none');
  });

  it('is focusable and labelled', () => {
    const element = viewport(create());
    expect(element.getAttribute('tabindex')).toBe('0');
    expect(element.getAttribute('aria-label')).not.toBeNull();
  });

  it('offers a visible button for every keyed gesture', () => {
    const fixture = create();
    const buttons = host(fixture).querySelectorAll('.bar button');
    expect(buttons.length).toBeGreaterThanOrEqual(3);
  });
});
