import { describe, expect, it } from 'vitest';
import { SseFrameDecoder } from './sse-parser';

describe('heartbeat frame observed on the live wire', () => {
  it('dispatches no event but advances lastEventId', () => {
    const d = new SseFrameDecoder();
    const bytes = new TextEncoder().encode(':heartbeat\nid:1\n\n:heartbeat\nid:2\n\n');
    const frames = d.push(bytes);
    const events = frames.filter((f) => f.kind === 'event');
    expect(events).toHaveLength(0);
    expect(frames.some((f) => f.kind === 'comment')).toBe(true);
    expect(d.lastEventId).toBe('2');
  });
});
