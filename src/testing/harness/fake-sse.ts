/**
 * A controllable `text/event-stream` for unit tests.
 *
 * The whole point of the SSE client's shape — an injected fetch, an injected random source, a
 * watchdog on a rearming `setTimeout` — is that the reconnect loop can be driven from here with
 * fake timers and no network at all. Without this harness the loop would only ever be exercised
 * by hand against a live backend, which is to say once.
 */
export interface FakeSse {
  readonly stream: ReadableStream<Uint8Array>;
  /** Enqueue raw wire text. Split it however you like — the decoder must cope. */
  push(text: string): void;
  /** Enqueue raw bytes, for the mid-codepoint and mid-line boundary cases. */
  pushBytes(bytes: Uint8Array): void;
  /** A clean end of stream: the server closed the body. */
  close(): void;
  /** A transport failure mid-stream. */
  fail(error?: unknown): void;
}

const encoder = new TextEncoder();

export function createFakeSse(): FakeSse {
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });

  const guard = (fn: (c: ReadableStreamDefaultController<Uint8Array>) => void): void => {
    if (closed || controller === null) return;
    fn(controller);
  };

  return {
    stream,
    push: (text) => guard((c) => c.enqueue(encoder.encode(text))),
    pushBytes: (bytes) => guard((c) => c.enqueue(bytes)),
    close: () =>
      guard((c) => {
        closed = true;
        c.close();
      }),
    fail: (error) =>
      guard((c) => {
        closed = true;
        c.error(error ?? new Error('fake-sse-failed'));
      }),
  };
}

export interface FakeConnection {
  readonly url: string;
  readonly init: RequestInit | undefined;
  readonly sse: FakeSse;
}

export interface FakeSseFetch {
  /** Drop-in for the `SSE_FETCH` token. */
  readonly fetch: (url: string, init?: RequestInit) => Promise<Response>;
  /** Every connection attempt, in order — url and headers included, for WEB-SEC-002 assertions. */
  readonly connections: FakeConnection[];
  /** Make the next `n` attempts resolve with this status instead of a stream. */
  respondWithStatus(status: number): void;
  /** Make the next attempt reject, as a DNS or refused-connection failure would. */
  failNextConnect(): void;
}

/**
 * A fetch stand-in that hands out a fresh `FakeSse` per connection attempt. Returns a duck-typed
 * `Response`: a real one would need a live body stream and buys nothing, since the client only
 * reads `status`, `ok` and `body`.
 */
export function createFakeSseFetch(): FakeSseFetch {
  const connections: FakeConnection[] = [];
  let forcedStatus: number | null = null;
  let failNext = false;

  const fetchFn = (url: string, init?: RequestInit): Promise<Response> => {
    if (failNext) {
      failNext = false;
      return Promise.reject(new Error('fake-connect-refused'));
    }
    if (forcedStatus !== null) {
      const status = forcedStatus;
      forcedStatus = null;
      connections.push({ url, init, sse: createFakeSse() });
      return Promise.resolve({ ok: status >= 200 && status < 300, status, body: null } as Response);
    }
    const sse = createFakeSse();
    connections.push({ url, init, sse });
    // A real fetch errors the body stream when its signal aborts. Reproducing that is what
    // lets the watchdog and the sign-out teardown be tested at all.
    init?.signal?.addEventListener('abort', () => sse.fail(new Error('fake-sse-aborted')));
    return Promise.resolve({ ok: true, status: 200, body: sse.stream } as unknown as Response);
  };

  return {
    fetch: fetchFn,
    connections,
    respondWithStatus: (status) => {
      forcedStatus = status;
    },
    failNextConnect: () => {
      failNext = true;
    },
  };
}
