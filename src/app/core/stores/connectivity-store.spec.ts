import { TestBed } from '@angular/core/testing';
import { ConnectivityStore } from './connectivity-store';

function store(): ConnectivityStore {
  TestBed.configureTestingModule({});
  return TestBed.inject(ConnectivityStore);
}

describe('ConnectivityStore (WEB-FR-402)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('seeds from navigator.onLine', () => {
    const connectivity = store();
    expect(connectivity.online()).toBe(globalThis.navigator.onLine);
  });

  it('follows the offline and online events', () => {
    const connectivity = store();

    connectivity.setOnline(true);
    globalThis.dispatchEvent(new Event('offline'));
    expect(connectivity.online()).toBe(false);
    expect(connectivity.offline()).toBe(true);

    globalThis.dispatchEvent(new Event('online'));
    expect(connectivity.online()).toBe(true);
  });

  it('stamps only real transitions', () => {
    const connectivity = store();
    connectivity.setOnline(true);
    const unchanged = connectivity.lastChangeAt();

    connectivity.setOnline(true);
    expect(connectivity.lastChangeAt()).toBe(unchanged);

    connectivity.setOnline(false);
    expect(connectivity.lastChangeAt()).not.toBe(unchanged);
  });

  it('stops listening once the injector is destroyed', () => {
    const connectivity = store();
    TestBed.resetTestingModule();

    globalThis.dispatchEvent(new Event('offline'));
    expect(connectivity.online()).toBe(true);
  });
});
