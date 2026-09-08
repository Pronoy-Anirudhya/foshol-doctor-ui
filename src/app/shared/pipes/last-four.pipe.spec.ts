import { APP_CONFIG } from '../../core/config/app-config';
import { LastFourPipe } from './last-four.pipe';

describe('LastFourPipe (WEB-SEC-006)', () => {
  const pipe = new LastFourPipe();

  it('shows only the last four digits of a phone number', () => {
    const masked = pipe.transform('+8801711111111');
    expect(masked.endsWith('1111')).toBe(true);
    expect(masked).not.toContain('880');
    expect(masked.replace(/\D/g, '').length).toBe(APP_CONFIG.auth.phoneVisibleDigits);
  });

  it('renders nothing rather than a bare mask when there is no number', () => {
    expect(pipe.transform(null)).toBe('');
    expect(pipe.transform(undefined)).toBe('');
    expect(pipe.transform('')).toBe('');
  });
});
