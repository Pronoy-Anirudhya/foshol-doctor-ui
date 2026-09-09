import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { APP_CONFIG } from '../../core/config/app-config';
import { toProblemView } from '../../core/errors/problem';
import { LiveAnnouncer } from '../../core/stores/live-announcer';
import { FarmersService } from '../../generated/services/farmers.service';
import { ErrorPanel } from '../../shared/ui/error-panel/error-panel';
import { ModalDialog } from '../../shared/ui/modal-dialog/modal-dialog';
import { checkCsv, templateBlob, type CsvRejection } from './farmer-csv';
import { farmerErrorKey } from './farmer-error-keys';
import { FarmerDirectoryStore } from './farmer-directory-store';

const NONE = 0;
/** Only ever used to say the byte cap in the unit an officer reads (WEB-NFR-009). */
const BYTES_PER_KIB = 1024;

/**
 * Bulk farmer registration from a CSV (`WEB-FR-313`).
 *
 * **The file on the officer's disk contains phone numbers**, which is the fact that shapes this
 * whole component. Its text is read exactly once, in memory, to count rows and compare the
 * header line — and is never rendered, never logged, never stored and never put anywhere a
 * later reader could reach it. What the officer sees about their own file is its name, its size
 * and how many data rows it holds. The server's per-row `message` is likewise documented as safe
 * display text that never contains a number (`IDENTITY-FR-025`), and is rendered as text.
 *
 * The client-side checks are a courtesy, not a gate: the server validates every row and its
 * answer is the one of record (`WEB-NFR-010`). They exist so an officer with the wrong file in
 * hand finds out immediately instead of after an upload.
 *
 * `Idempotency-Key` is deliberately NOT sent here. The contract declares it on
 * `POST /api/v1/farmers` only, and inventing a header the spec does not define would be exactly
 * the guessing `WEB-API-001` forbids.
 */
@Component({
  selector: 'foshol-farmer-import-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, ModalDialog, ErrorPanel],
  host: { class: 'contents' },
  templateUrl: './farmer-import-dialog.html',
})
export class FarmerImportDialog {
  private readonly farmers = inject(FarmersService);
  private readonly announcer = inject(LiveAnnouncer);
  protected readonly store = inject(FarmerDirectoryStore);

  readonly open = input(false);
  readonly closed = output<void>();
  /** At least one row landed, so the directory behind this dialog is out of date. */
  readonly imported = output<void>();

  protected readonly maxRows = APP_CONFIG.farmers.importMaxRows;
  protected readonly maxKib = APP_CONFIG.farmers.importMaxBytes / BYTES_PER_KIB;
  protected readonly templateHeader = APP_CONFIG.farmers.templateHeader;

  /** The chosen file. Held only until the upload resolves; its CONTENTS are never held. */
  private readonly file = signal<File | null>(null);
  protected readonly fileName = computed(() => this.file()?.name ?? null);
  protected readonly fileSize = computed(() => this.file()?.size ?? NONE);

  protected readonly dataRows = signal<number>(NONE);
  protected readonly rejection = signal<CsvRejection | null>(null);
  protected readonly downloading = signal(false);
  protected readonly downloadFailed = signal(false);

  protected readonly ready = computed(() => this.file() !== null && this.rejection() === null);

  protected readonly results = this.store.importResults;

  protected readonly problemKey = computed(() => farmerErrorKey(this.store.importProblem()?.code));

  /**
   * The template, as a file the browser saves.
   *
   * `Content-Disposition` is not exposed across origins here, so the filename comes from the
   * contract via `APP_CONFIG` rather than from a header we cannot read. The BOM is re-applied by
   * `templateBlob` because the operation is declared `type: string` and arrives as text.
   */
  protected async downloadTemplate(): Promise<void> {
    this.downloading.set(true);
    this.downloadFailed.set(false);
    let url: string | null = null;
    try {
      const csv = await this.farmers.downloadFarmerImportTemplate();
      url = URL.createObjectURL(templateBlob(csv));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = APP_CONFIG.farmers.templateFilename;
      anchor.click();
      this.announcer.announce('farmers.import.templateAnnounced');
    } catch {
      // WEB-FR-404 — the raw failure is never shown; a plain retryable message stands in.
      this.downloadFailed.set(true);
    } finally {
      if (url !== null) URL.revokeObjectURL(url);
      this.downloading.set(false);
    }
  }

  protected async onFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const chosen = input.files?.item(NONE) ?? null;

    this.store.resetImport();
    this.file.set(chosen);
    this.rejection.set(null);
    this.dataRows.set(NONE);
    if (chosen === null) return;

    // Read once, in memory, purely to count rows and compare the header. Nothing is retained.
    const text = await chosen.text();
    const check = checkCsv(text, chosen.size);
    this.rejection.set(check.rejection);
    this.dataRows.set(check.dataRows);
  }

  protected async upload(): Promise<void> {
    const chosen = this.file();
    if (chosen === null || this.rejection() !== null || this.store.importing()) return;

    this.store.beginImport();
    try {
      // The generated client builds the multipart body; no hand-rolled FormData (WEB-API-001).
      const results = await this.farmers.importFarmers({ body: { file: chosen } });
      this.store.importSucceeded(results);
      this.announcer.announce('farmers.import.announced', {
        succeeded: results.succeeded,
        failed: results.failed,
      });
      if (results.succeeded > NONE) this.imported.emit();
    } catch (error: unknown) {
      this.store.importFailed(toProblemView(error));
    }
  }

  /** Clears the picked file and any result, leaving the dialog ready for another import. */
  protected reset(): void {
    this.file.set(null);
    this.rejection.set(null);
    this.dataRows.set(NONE);
    this.downloadFailed.set(false);
    this.store.resetImport();
  }

  protected close(): void {
    this.reset();
    this.closed.emit();
  }
}
