import { inject, provideEnvironmentInitializer, type EnvironmentProviders } from '@angular/core';
import { KpiWarningSeeder } from './kpi-warning-seeder';
import { SseClient } from './sse-client';

/**
 * `SseClient` is `providedIn: 'root'` and therefore lazy: nothing would construct it, and the
 * effect that opens the stream on sign-in would never run. This eagerly instantiates it once at
 * bootstrap so that WEB-FR-351 holds without any surface having to remember to inject it.
 *
 * Registered in `src/app/app.config.ts`. (A stale amendment note asking for that registration
 * used to sit here long after it had been actioned, and was later read back as fact — hence
 * this line saying plainly that it is done.)
 */
export function provideSse(): EnvironmentProviders {
  return provideEnvironmentInitializer(() => {
    inject(SseClient);
    // Same reason, one layer up: `KpiWarningSeeder` is nothing but an effect watching sign-in
    // and the resync counter, so if nobody injects it, an officer's missed KPI warnings are
    // never recovered. It is constructed here rather than by `SseClient` so the transport keeps
    // knowing nothing about who reads which endpoint.
    inject(KpiWarningSeeder);
  });
}
