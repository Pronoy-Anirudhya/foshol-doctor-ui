/**
 * A WHATWG "server-sent events" frame decoder, as a pure function object.
 *
 * No Angular, no fetch, no timers: the whole of the wire-format risk is concentrated here and
 * is testable by feeding it byte arrays split at deliberately awkward offsets.
 *
 * Two properties are load-bearing and are the reason this is not three lines of `split`:
 *
 *  1. **Codepoints split across chunk boundaries.** Every payload on this stream is Bangla,
 *     which is three bytes per codepoint in UTF-8, so a network chunk boundary lands mid-
 *     character routinely rather than rarely. `TextDecoder.decode(bytes, { stream: true })`
 *     holds the partial sequence back until the rest arrives; decoding each chunk
 *     independently would corrupt roughly one in three long Bangla frames.
 *  2. **Line terminators split across chunk boundaries.** The spec allows `\r\n`, `\n` and a
 *     lone `\r`. A chunk that ends in `\r` is ambiguous until the next byte is seen, so the
 *     trailing `\r` is held back rather than guessed at.
 */

const UTF8 = 'utf-8';
const LF = '\n';
const CR = '\r';
const COLON = ':';
const SPACE = ' ';
const NUL = '\u0000';
/** WHATWG: an event with no `event:` field is delivered under this name. */
const DEFAULT_EVENT = 'message';

const FIELD_EVENT = 'event';
const FIELD_DATA = 'data';
const FIELD_ID = 'id';
const FIELD_RETRY = 'retry';

const DIGITS = /^\d+$/;
/** `\r\n` or a lone `\r`, both normalised to `\n`. */
const LINE_END = /\r\n?/g;

export interface SseEventFrame {
  readonly kind: 'event';
  readonly event: string;
  readonly data: string;
  /** The persistent last event id at the moment of dispatch — `null` if none has been seen. */
  readonly id: string | null;
}

/**
 * A `:` comment line. The server sends one every `foshol.channels.sse.heartbeat`, and it is
 * the ONLY evidence that a connection dead behind a proxy is in fact dead — so it is surfaced
 * rather than swallowed, and the client stamps "last byte seen" from it.
 */
export interface SseCommentFrame {
  readonly kind: 'comment';
  readonly text: string;
}

/** `retry: <int>` — the server proposing a new base reconnect delay. */
export interface SseRetryFrame {
  readonly kind: 'retry';
  readonly delayMs: number;
}

export type SseFrame = SseEventFrame | SseCommentFrame | SseRetryFrame;

export class SseFrameDecoder {
  readonly #decoder = new TextDecoder(UTF8);
  #buffer = '';
  /** A `\r` seen at the very end of a chunk: a line end, unless the next byte is `\n`. */
  #pendingCr = false;

  #event = '';
  #data: string[] = [];
  #sawDataField = false;
  #lastEventId: string | null;

  constructor(lastEventId: string | null = null) {
    this.#lastEventId = lastEventId;
  }

  /** Persists across events by design (WHATWG): only an `id:` field replaces it. */
  get lastEventId(): string | null {
    return this.#lastEventId;
  }

  push(bytes: Uint8Array): SseFrame[] {
    return this.#ingest(this.#decoder.decode(bytes, { stream: true }));
  }

  /** End of stream: decode whatever the decoder was holding. A partial line is discarded. */
  flush(): SseFrame[] {
    const tail = this.#decoder.decode();
    return tail.length > 0 ? this.#ingest(tail) : [];
  }

  #ingest(chunk: string): SseFrame[] {
    let text = chunk;
    if (this.#pendingCr) {
      this.#pendingCr = false;
      text = CR + text;
    }
    if (text.endsWith(CR)) {
      this.#pendingCr = true;
      text = text.slice(0, -1);
    }
    this.#buffer += text.replace(LINE_END, LF);

    const frames: SseFrame[] = [];
    for (;;) {
      const end = this.#buffer.indexOf(LF);
      if (end === -1) break;
      const line = this.#buffer.slice(0, end);
      this.#buffer = this.#buffer.slice(end + 1);
      const frame = this.#line(line);
      if (frame !== null) frames.push(frame);
    }
    return frames;
  }

  #line(line: string): SseFrame | null {
    if (line.length === 0) return this.#dispatch();
    if (line.startsWith(COLON)) {
      return { kind: 'comment', text: line.slice(COLON.length) };
    }

    const colon = line.indexOf(COLON);
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + COLON.length);
    if (value.startsWith(SPACE)) value = value.slice(SPACE.length);

    switch (field) {
      case FIELD_EVENT:
        this.#event = value;
        return null;
      case FIELD_DATA:
        this.#data.push(value);
        this.#sawDataField = true;
        return null;
      case FIELD_ID:
        // WHATWG: an id containing U+0000 is ignored outright.
        if (!value.includes(NUL)) this.#lastEventId = value;
        return null;
      case FIELD_RETRY:
        return DIGITS.test(value) ? { kind: 'retry', delayMs: Number(value) } : null;
      default:
        // An unknown field is ignored, exactly as the spec requires (WEB-FR-352 in miniature).
        return null;
    }
  }

  #dispatch(): SseEventFrame | null {
    const event = this.#event;
    const sawData = this.#sawDataField;
    const data = this.#data.join(LF);

    // Reset the per-event buffers. `lastEventId` deliberately survives: WHATWG makes it
    // sticky so a reconnect can resume from the last id even if later events omitted one.
    this.#event = '';
    this.#data = [];
    this.#sawDataField = false;

    // WHATWG dispatches nothing when the data buffer is empty. This decoder is one notch more
    // lenient — a named event with no data still dispatches — because `resync` and `reconnect`
    // are semantically complete without a body and dropping them would strand the client.
    if (!sawData && event.length === 0) return null;

    return { kind: 'event', event: event.length > 0 ? event : DEFAULT_EVENT, data, id: this.#lastEventId };
  }
}
