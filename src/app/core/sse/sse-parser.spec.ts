import { SseFrameDecoder, type SseEventFrame, type SseFrame } from './sse-parser';

const encoder = new TextEncoder();
const bytes = (text: string): Uint8Array => encoder.encode(text);

/** Feed `text` to the decoder one chunk at a time, splitting at the given BYTE offsets. */
function feedSplitAt(decoder: SseFrameDecoder, text: string, offsets: readonly number[]): SseFrame[] {
  const all = bytes(text);
  const cuts = [0, ...offsets, all.length];
  const frames: SseFrame[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const chunk = all.slice(cuts[i], cuts[i + 1]);
    if (chunk.length === 0) continue;
    frames.push(...decoder.push(chunk));
  }
  return frames;
}

const events = (frames: readonly SseFrame[]): SseEventFrame[] =>
  frames.filter((f): f is SseEventFrame => f.kind === 'event');

describe('SseFrameDecoder', () => {
  it('decodes a complete frame delivered in one chunk', () => {
    const decoder = new SseFrameDecoder();
    const frames = decoder.push(bytes('event: queue\nid: e-1\ndata: {"caseId":"c1"}\n\n'));

    expect(frames).toHaveLength(1);
    expect(frames[0]).toEqual({ kind: 'event', event: 'queue', data: '{"caseId":"c1"}', id: 'e-1' });
  });

  it('defaults an unnamed event to "message"', () => {
    const decoder = new SseFrameDecoder();
    const frames = events(decoder.push(bytes('data: hello\n\n')));
    expect(frames[0]?.event).toBe('message');
  });

  // The reason TextDecoder is used with { stream: true }: Bangla is three bytes per codepoint,
  // so a chunk boundary lands mid-character routinely rather than rarely.
  it('reassembles a Bangla payload split mid-UTF-8-sequence', () => {
    const bangla = 'ধানের পাতায় বাদামি দাগ দেখা যাচ্ছে';
    const wire = `event: advisory\ndata: ${bangla}\n\n`;
    const total = bytes(wire).length;

    // Every single-byte boundary in the whole frame, which necessarily includes boundaries
    // inside multi-byte sequences.
    for (let cut = 1; cut < total; cut++) {
      const decoder = new SseFrameDecoder();
      const frames = events(feedSplitAt(decoder, wire, [cut]));
      expect(frames).toHaveLength(1);
      expect(frames[0]?.data).toBe(bangla);
    }
  });

  it('handles a byte-by-byte drip of a Bangla frame', () => {
    const bangla = 'পরামর্শ প্রকাশিত হয়েছে';
    const all = bytes(`event: advisory\ndata: ${bangla}\n\n`);
    const decoder = new SseFrameDecoder();
    const frames: SseFrame[] = [];
    for (const byte of all) frames.push(...decoder.push(Uint8Array.of(byte)));

    expect(events(frames)).toHaveLength(1);
    expect(events(frames)[0]?.data).toBe(bangla);
  });

  it('handles a lone newline arriving in its own chunk', () => {
    const decoder = new SseFrameDecoder();
    expect(decoder.push(bytes('event: resync\ndata: {}'))).toHaveLength(0);
    expect(decoder.push(bytes('\n'))).toHaveLength(0);
    const frames = events(decoder.push(bytes('\n')));
    expect(frames).toHaveLength(1);
    expect(frames[0]?.event).toBe('resync');
  });

  it('holds back a trailing CR so CRLF split across chunks is one line end', () => {
    const decoder = new SseFrameDecoder();
    expect(decoder.push(bytes('data: a\r'))).toHaveLength(0);
    const frames = events(decoder.push(bytes('\n\r\n')));
    expect(frames).toHaveLength(1);
    expect(frames[0]?.data).toBe('a');
  });

  it('treats a lone CR as a line end', () => {
    const decoder = new SseFrameDecoder();
    const frames = events(decoder.push(bytes('event: queue\rdata: x\r\r\n')));
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ event: 'queue', data: 'x' });
  });

  it('emits a comment frame for a heartbeat, and does not dispatch it as an event', () => {
    const decoder = new SseFrameDecoder();
    const frames = decoder.push(bytes(': heartbeat\n'));
    expect(frames).toEqual([{ kind: 'comment', text: ' heartbeat' }]);
    expect(events(frames)).toHaveLength(0);
  });

  it('emits a comment even when the comment is split in half', () => {
    const decoder = new SseFrameDecoder();
    expect(decoder.push(bytes(': heart'))).toHaveLength(0);
    expect(decoder.push(bytes('beat\n'))).toEqual([{ kind: 'comment', text: ' heartbeat' }]);
  });

  it('strips exactly one leading space from a field value', () => {
    const decoder = new SseFrameDecoder();
    const frames = events(decoder.push(bytes('data:  two-spaces\n\n')));
    expect(frames[0]?.data).toBe(' two-spaces');
  });

  it('joins multiple data lines with a newline', () => {
    const decoder = new SseFrameDecoder();
    const frames = events(decoder.push(bytes('data: one\ndata: two\n\n')));
    expect(frames[0]?.data).toBe('one\ntwo');
  });

  it('treats a field with no colon as an empty value', () => {
    const decoder = new SseFrameDecoder();
    const frames = events(decoder.push(bytes('event\ndata: x\n\n')));
    expect(frames[0]?.event).toBe('message');
  });

  it('ignores unknown fields without disturbing the frame', () => {
    const decoder = new SseFrameDecoder();
    const frames = events(decoder.push(bytes('event: queue\nfuture: 1\ndata: x\n\n')));
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ event: 'queue', data: 'x' });
  });

  it('persists lastEventId across events that omit an id (WHATWG)', () => {
    const decoder = new SseFrameDecoder();
    const first = events(decoder.push(bytes('id: e-1\ndata: a\n\n')));
    const second = events(decoder.push(bytes('data: b\n\n')));

    expect(first[0]?.id).toBe('e-1');
    expect(second[0]?.id).toBe('e-1');
    expect(decoder.lastEventId).toBe('e-1');
  });

  it('resumes from a supplied lastEventId', () => {
    const decoder = new SseFrameDecoder('e-9');
    expect(events(decoder.push(bytes('data: a\n\n')))[0]?.id).toBe('e-9');
  });

  it('surfaces retry: as its own frame and ignores a non-integer retry', () => {
    const decoder = new SseFrameDecoder();
    expect(decoder.push(bytes('retry: 4500\n'))).toEqual([{ kind: 'retry', delayMs: 4500 }]);
    expect(decoder.push(bytes('retry: soon\n'))).toHaveLength(0);
  });

  it('does not dispatch on a blank line when nothing was buffered', () => {
    const decoder = new SseFrameDecoder();
    expect(decoder.push(bytes('\n\n\n'))).toHaveLength(0);
  });

  it('separates two frames arriving in one chunk', () => {
    const decoder = new SseFrameDecoder();
    const frames = events(decoder.push(bytes('event: a\ndata: 1\n\nevent: b\ndata: 2\n\n')));
    expect(frames.map((f) => f.event)).toEqual(['a', 'b']);
    expect(frames.map((f) => f.data)).toEqual(['1', '2']);
  });
});
