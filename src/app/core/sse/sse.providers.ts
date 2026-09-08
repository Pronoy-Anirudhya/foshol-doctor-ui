import { inject, provideEnvironmentInitializer, type EnvironmentProviders } from '@angular/core';
import { SseClient } from './sse-client';

/**
 * `SseClient` is `providedIn: 'root'` and therefore lazy: nothing would construct it, and the
 * effect that opens the stream on sign-in would never run. This eagerly instantiates it once at
 * bootstrap so that WEB-FR-351 holds without any surface having to remember to inject it.
 *
 * AMENDMENT REQUEST (owner: the shell agent, `src/app/app.config.ts`): add `provideSse()` to
 * the `providers` array. Until it is added the stream never opens.
 */
export function provideSse(): EnvironmentProviders {
  return provideEnvironmentInitializer(() => {
    inject(SseClient);
  });
}
