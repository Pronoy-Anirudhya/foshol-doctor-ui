import { CountdownPipe } from './countdown.pipe';

describe('CountdownPipe', () => {
  const pipe = new CountdownPipe();

  it('renders mm:ss zero-padded', () => {
    expect(pipe.transform(0)).toBe('00:00');
    expect(pipe.transform(9_000)).toBe('00:09');
    expect(pipe.transform(65_000)).toBe('01:05');
    // review.claimTtlMs
    expect(pipe.transform(900_000)).toBe('15:00');
    // auth.otpTtlMs
    expect(pipe.transform(300_000)).toBe('05:00');
  });

  it('truncates rather than rounds, so it never shows a second that has not elapsed', () => {
    expect(pipe.transform(1_999)).toBe('00:01');
  });

  it('clamps an expired remainder to 00:00 rather than counting into the negative', () => {
    // An expired claim is a state the surrounding component handles; a ticking minus sign on
    // screen reads as a bug to anyone watching the demo.
    expect(pipe.transform(-1)).toBe('00:00');
    expect(pipe.transform(-90_000)).toBe('00:00');
  });

  it('survives an absent or non-finite value', () => {
    expect(pipe.transform(null)).toBe('00:00');
    expect(pipe.transform(undefined)).toBe('00:00');
    expect(pipe.transform(Number.NaN)).toBe('00:00');
  });
});
