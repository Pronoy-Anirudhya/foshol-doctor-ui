import { ChangeDetectionStrategy, Component, computed, inject, signal, viewChild, type ElementRef } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { SessionStore } from '../../core/auth/session-store';
import { LanguageStore } from '../../core/i18n/language-store';
import { PageHeading } from '../../shared/ui/page-heading/page-heading';
import { FarmerDirectorySection } from './farmer-directory-section';
import { FarmerDirectoryStore } from './farmer-directory-store';
import { FarmerImportDialog } from './farmer-import-dialog';
import { FarmerRegisterDialog } from './farmer-register-dialog';

/** WEB-NFR-009 — no numeric literal inside a component; the module const is the house idiom. */
const FIRST_PAGE = 0;

/**
 * Staff farmer provision — ONE page, mounted at both `/officer/farmers` and `/admin/farmers`
 * (`WEB-FR-310`).
 *
 * There is deliberately no officer variant and no admin variant of anything below this line.
 * The two surfaces call the same operations with the same district scope, so two components
 * would be two chances for them to disagree about a rule the server applies once. The console
 * chrome already differs by role in `AppShell`; the work does not.
 *
 * Nothing here reads the URL to decide what the user may do. `app.routes.ts` guards both mounts
 * with `roleGuard`, and the server scopes every request to the caller's own district from the
 * JWT — so this page never asks who it is talking to (`WEB-SEC-002`).
 *
 * The store is provided HERE rather than at the root, so a district's farmer list and a
 * half-typed registration die with the route instead of surviving into the next session.
 */
@Component({
  selector: 'foshol-farmers-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [FarmerDirectoryStore],
  imports: [TranslatePipe, PageHeading, FarmerDirectorySection, FarmerRegisterDialog, FarmerImportDialog],
  host: { class: 'block' },
  templateUrl: './farmers-page.html',
})
export class FarmersPage {
  private readonly session = inject(SessionStore);
  private readonly language = inject(LanguageStore);
  private readonly store = inject(FarmerDirectoryStore);

  protected readonly registerOpen = signal(false);
  protected readonly importOpen = signal(false);

  /**
   * The buttons that open each dialog. `<dialog>` restores focus to whatever was focused when
   * `showModal()` ran, which is these — but only while they are still in the DOM, so they are
   * held rather than assumed.
   */
  private readonly registerButton = viewChild<ElementRef<HTMLButtonElement>>('registerButton');
  private readonly importButton = viewChild<ElementRef<HTMLButtonElement>>('importButton');

  /** The district being written into, named in the subtitle so the scope is never a surprise. */
  protected readonly districtLabel = computed(() => {
    const region = this.session.region();
    if (region === null) return '';
    const name = this.language.isBangla() ? region.districtNameBn : region.districtNameEn;
    return name ?? region.districtCode ?? '';
  });

  protected openRegister(): void {
    this.store.resetRegister();
    this.registerOpen.set(true);
  }

  protected closeRegister(): void {
    this.registerOpen.set(false);
    this.registerButton()?.nativeElement.focus();
  }

  protected openImport(): void {
    this.store.resetImport();
    this.importOpen.set(true);
  }

  protected closeImport(): void {
    this.importOpen.set(false);
    this.importButton()?.nativeElement.focus();
  }

  /**
   * A write landed, so the list behind the dialog is out of date. Going to the first page is
   * both the refresh and the right destination: a new farmer is the newest, and the server
   * orders newest first, so page 0 is exactly where it will appear. `goToPage` writes a fresh
   * filters object every time, so the section's load effect re-fires even when the page number
   * is unchanged — which is what makes this a reload rather than a no-op on page 0.
   */
  protected onWrote(): void {
    this.store.goToPage(FIRST_PAGE);
  }
}
