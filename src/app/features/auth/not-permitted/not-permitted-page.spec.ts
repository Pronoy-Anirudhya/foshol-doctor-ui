import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SessionStore } from '../../../core/auth/session-store';
import { ApiConfiguration } from '../../../generated/api-configuration';
import { APP_CONFIG } from '../../../core/config/app-config';
import { provideI18n } from '../../../core/i18n/i18n.providers';
import { NotPermittedPage } from './not-permitted-page';

describe('NotPermittedPage (WEB-FR-003)', () => {
  let fixture: ComponentFixture<NotPermittedPage>;
  let session: SessionStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideI18n(),
        { provide: ApiConfiguration, useValue: { rootUrl: APP_CONFIG.api.origin } },
      ],
    });
    session = TestBed.inject(SessionStore);
  });

  async function render(): Promise<HTMLElement> {
    fixture = TestBed.createComponent(NotPermittedPage);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('offers the sign-in page when there is no session', async () => {
    const el = await render();
    expect(el.querySelector('a')?.getAttribute('href')).toBe('/auth/farmer');
    expect(el.querySelector('.role-chip')).toBeNull();
  });

  it('names the role and links to its home', async () => {
    session.signIn('header.payload.signature', { id: 'x', name: 'Demo', role: 'OFFICER' }, new Date());

    const el = await render();
    expect(el.querySelector('a')?.getAttribute('href')).toBe('/officer');
    expect(el.querySelector('.role-chip')?.textContent?.trim().length).toBeGreaterThan(0);
  });
});
