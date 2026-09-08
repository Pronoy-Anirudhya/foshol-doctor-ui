import { asyncSignal } from './async-signal';

describe('asyncSignal', () => {
  it('publishes the loaded value and stamps the load time', async () => {
    const state = asyncSignal(() => Promise.resolve('value'), () => 42);
    await state.reload();

    expect(state.value()).toBe('value');
    expect(state.loadedAt()).toBe(42);
    expect(state.loading()).toBe(false);
    expect(state.error()).toBeNull();
  });

  it('keeps the last good value when a later load fails', async () => {
    let fail = false;
    const state = asyncSignal(() => (fail ? Promise.reject(new Error('boom')) : Promise.resolve('good')));

    await state.reload();
    fail = true;
    await state.reload();

    expect(state.value()).toBe('good');
    expect(state.stale()).toBe(true);
    expect(state.error()).toBeInstanceOf(Error);
  });

  it('is not stale before anything has ever loaded', async () => {
    const state = asyncSignal(() => Promise.reject(new Error('boom')));
    await state.reload();

    expect(state.value()).toBeNull();
    expect(state.stale()).toBe(false);
  });

  // Two overlapping reloads race; the slower one must not overwrite the newer answer.
  it('drops an out-of-order response', async () => {
    const resolvers: ((value: string) => void)[] = [];
    const state = asyncSignal(() => new Promise<string>((resolve) => resolvers.push(resolve)));

    const first = state.reload();
    const second = state.reload();

    resolvers[1]('newer');
    resolvers[0]('older');
    await Promise.all([first, second]);

    expect(state.value()).toBe('newer');
  });

  it('accepts a value pushed in from elsewhere', () => {
    const state = asyncSignal(() => Promise.resolve('loaded'), () => 7);
    state.set('pushed');

    expect(state.value()).toBe('pushed');
    expect(state.loadedAt()).toBe(7);
  });

  it('clears everything and ignores a load that was already in flight', async () => {
    const resolvers: ((value: string) => void)[] = [];
    const state = asyncSignal(() => new Promise<string>((resolve) => resolvers.push(resolve)));

    const inFlight = state.reload();
    state.clear();
    resolvers[0]('too late');
    await inFlight;

    expect(state.value()).toBeNull();
    expect(state.loading()).toBe(false);
  });
});
