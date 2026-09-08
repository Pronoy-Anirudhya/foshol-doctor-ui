import { ChangeDetectionStrategy, Component } from '@angular/core';
import { AppShell } from './shared/ui/app-shell/app-shell';

/**
 * The bootstrapped root. It holds no state and renders one thing: the shell.
 *
 * `RouterOutlet` lives inside `<foshol-app-shell>`, not here, so every route gets the skip
 * link, the header, the offline banner, the toast stack and the single live region without a
 * feature having to remember them (WEB-UX-040, WEB-UX-046, WEB-FR-402). Importing it here as
 * well is what produced the NG8113 unused-import warning the CLI scaffold left behind, and
 * the production build must be warning-free.
 */
@Component({
  selector: 'foshol-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AppShell],
  templateUrl: './app.html',
  // `display: contents` so the root element adds no box of its own and the shell's
  // `min-h-dvh` column measures against the viewport rather than an inline wrapper.
  host: { class: 'contents' },
})
export class App {}
