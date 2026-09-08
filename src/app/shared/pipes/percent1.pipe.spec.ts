import { APP_CONFIG } from '../../core/config/app-config';
import { Percent1Pipe } from './percent1.pipe';

describe('Percent1Pipe (WEB-TEST-001 boundary)', () => {
  const pipe = new Percent1Pipe();

  it('renders a threshold exactly, where naive arithmetic does not', () => {
    // 0.45 * 100 === 45.00000000000001 in IEEE-754. A threshold line a hair off its value is
    // precisely the bug the boundary test exists to catch.
    expect(pipe.transform(APP_CONFIG.analysis.confidenceLowFallback)).toBe(45);
    expect(pipe.transform(APP_CONFIG.analysis.confidenceHighFallback)).toBe(75);
  });

  it('keeps one decimal and no more', () => {
    expect(pipe.transform(0.7243)).toBe(72.4);
    expect(pipe.transform(0.99999)).toBe(100);
  });

  it('clamps out-of-range and absent values instead of rendering nonsense', () => {
    expect(pipe.transform(1.4)).toBe(100);
    expect(pipe.transform(-0.2)).toBe(0);
    expect(pipe.transform(null)).toBe(0);
    expect(pipe.transform(undefined)).toBe(0);
  });
});
