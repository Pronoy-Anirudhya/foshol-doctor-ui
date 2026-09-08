import type { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { LanguageStore } from '../i18n/language-store';
import { isApiOriginUrl } from './auth.interceptor';

const ACCEPT_LANGUAGE_HEADER = 'Accept-Language';

/**
 * WEB-FR-006 — every API request carries `Accept-Language` matching `LanguageStore.current`
 * (COMMON-API-003), so a server-authored message comes back in the language the toggle is
 * showing. Toggling the language therefore changes server copy on the next request without a
 * reload (WEB-UX-012).
 *
 * WEB-SEC-003's origin rule applies here too: a presigned object-store URL gets none of our
 * request decoration.
 */
export const acceptLanguageInterceptor: HttpInterceptorFn = (req, next) => {
  if (!isApiOriginUrl(req.url)) return next(req);

  const locale = inject(LanguageStore).current();
  return next(req.clone({ setHeaders: { [ACCEPT_LANGUAGE_HEADER]: locale } }));
};
