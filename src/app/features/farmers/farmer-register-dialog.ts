import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { SessionStore } from '../../core/auth/session-store';
import { APP_CONFIG } from '../../core/config/app-config';
import { toProblemView } from '../../core/errors/problem';
import { LanguageStore } from '../../core/i18n/language-store';
import { LiveAnnouncer } from '../../core/stores/live-announcer';
import type { RegisterFarmerRequest } from '../../generated/models/register-farmer-request';
import { AuthService } from '../../generated/services/auth.service';
import { FarmersService } from '../../generated/services/farmers.service';
import { ErrorPanel } from '../../shared/ui/error-panel/error-panel';
import { ModalDialog } from '../../shared/ui/modal-dialog/modal-dialog';
import { farmerErrorKey } from './farmer-error-keys';
import { FarmerDirectoryStore } from './farmer-directory-store';

/** Present when the server replayed a previously-seen Idempotency-Key with an identical body. */
const REPLAYED_HEADER = 'Idempotency-Replayed';

type Locale = RegisterFarmerRequest['preferredLanguage'];

/**
 * Register one farmer (`WEB-FR-311`).
 *
 * **Field order is the requirement, not a layout choice.** Phone, then name, then language —
 * because that is the order the conversation happens in: an officer has just sold seed and the
 * first thing they have is the number. The form is built to be filled top to bottom while
 * talking to someone.
 *
 * **Division and district are locked to `GET /api/v1/me`** (`WEB-FR-314`). They are rendered as
 * disabled controls rather than hidden, so an officer can see the scope they are writing into
 * and cannot silently register into the wrong district. The geo catalogue may list every
 * district in Bangladesh; it is consulted here ONLY to put a name to the principal's own codes
 * when the principal itself carried none, and never to widen what may be submitted.
 *
 * **The phone is write-only.** It lives in this form control until a submit succeeds and is
 * cleared the instant it does. It is never rendered from a response (no response carries one),
 * never put in a URL, never logged, and never stored (`WEB-SEC-002`).
 */
@Component({
  selector: 'foshol-farmer-register-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, TranslatePipe, ModalDialog, ErrorPanel],
  host: { class: 'contents' },
  templateUrl: './farmer-register-dialog.html',
})
export class FarmerRegisterDialog {
  private readonly farmers = inject(FarmersService);
  private readonly auth = inject(AuthService);
  private readonly session = inject(SessionStore);
  private readonly language = inject(LanguageStore);
  private readonly announcer = inject(LiveAnnouncer);
  protected readonly store = inject(FarmerDirectoryStore);

  readonly open = input(false);
  readonly closed = output<void>();
  /** A farmer was created, so the directory behind this dialog is now out of date. */
  readonly registered = output<void>();

  protected readonly nameMaxLength = APP_CONFIG.farmers.nameMaxLength;
  protected readonly locales: readonly Locale[] = APP_CONFIG.i18n.supportedLocales;

  protected readonly form = new FormGroup({
    phone: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(APP_CONFIG.farmers.phonePattern)],
    }),
    name: new FormControl('', {
      nonNullable: true,
      validators: [
        Validators.required,
        Validators.maxLength(APP_CONFIG.farmers.nameMaxLength),
      ],
    }),
    preferredLanguage: new FormControl<Locale>(APP_CONFIG.i18n.defaultLocale, { nonNullable: true }),
  });

  /** Errors appear only after a submit attempt, matching both login screens. */
  protected readonly attempted = signal(false);

  /** Geo names the principal did not carry, fetched from the catalogue purely as labels. */
  private readonly fallbackDivisionName = signal<string | null>(null);
  private readonly fallbackDistrictName = signal<string | null>(null);

  protected readonly region = this.session.region;

  /**
   * The two codes that will be submitted. `null` means the principal has no district at all, in
   * which case there is nothing honest to send and the form refuses rather than guessing.
   */
  protected readonly divisionCode = computed(() => this.region()?.divisionCode ?? null);
  protected readonly districtCode = computed(() => this.region()?.districtCode ?? null);

  protected readonly scopeKnown = computed(
    () => this.divisionCode() !== null && this.districtCode() !== null,
  );

  protected readonly divisionLabel = computed(() =>
    this.label(
      this.language.isBangla() ? this.region()?.divisionNameBn : this.region()?.divisionNameEn,
      this.fallbackDivisionName(),
      this.divisionCode(),
    ),
  );

  protected readonly districtLabel = computed(() =>
    this.label(
      this.language.isBangla() ? this.region()?.districtNameBn : this.region()?.districtNameEn,
      this.fallbackDistrictName(),
      this.districtCode(),
    ),
  );

  protected readonly phoneInvalid = computed(
    () => this.attempted() && this.form.controls.phone.invalid,
  );
  protected readonly nameInvalid = computed(
    () => this.attempted() && this.form.controls.name.invalid,
  );

  /** A code we have specific copy for; otherwise `ErrorPanel`'s status fallback speaks. */
  protected readonly problemKey = computed(() => farmerErrorKey(this.store.registerProblem()?.code));

  protected readonly succeeded = computed(() => this.store.submitState() === 'succeeded');

  constructor() {
    effect(() => {
      if (this.open()) void this.ensureGeoLabels();
    });
  }

  /**
   * Bound to `(input)`/`(change)` on the three controls rather than to `form.valueChanges`: a
   * `valueChanges` subscription would be a long-lived manual subscription, which this codebase
   * allows only in the SSE client (`WEB-NFR-002`/`003`). The effect is the same — an edit means
   * the next submit is a new attempt, so the Idempotency-Key is retired.
   */
  protected onEdit(): void {
    this.store.contentChanged();
  }

  /**
   * `Principal.districtNameBn/En` are nullable on the contract. When they are absent, the geo
   * catalogue is asked for a label — and ONLY for a label. `WEB-FR-314`: whatever it returns,
   * the codes submitted stay the principal's, so a catalogue listing other districts cannot
   * widen this form's reach. When the principal already carried names, no request is made.
   */
  private async ensureGeoLabels(): Promise<void> {
    const region = this.region();
    if (region === null) return;

    const divisionCode = region.divisionCode;
    if (divisionCode !== null && region.divisionNameBn === null && region.divisionNameEn === null) {
      try {
        const divisions = await this.auth.listDivisions();
        const match = divisions.find((division) => division.code === divisionCode);
        this.fallbackDivisionName.set(
          (this.language.isBangla() ? match?.nameBn : match?.nameEn) ?? null,
        );
      } catch {
        // The label degrades to the code, which is still true and still scopes the write.
      }
    }

    const districtCode = region.districtCode;
    if (
      divisionCode !== null &&
      districtCode !== null &&
      region.districtNameBn === null &&
      region.districtNameEn === null
    ) {
      try {
        const districts = await this.auth.listDistrictsByDivision({ divisionCode });
        const match = districts.find((district) => district.code === districtCode);
        this.fallbackDistrictName.set(
          (this.language.isBangla() ? match?.nameBn : match?.nameEn) ?? null,
        );
      } catch {
        // As above — a missing label never blocks a registration.
      }
    }
  }

  private label(fromPrincipal: string | null | undefined, fallback: string | null, code: string | null): string {
    return fromPrincipal ?? fallback ?? code ?? '';
  }

  protected async submit(): Promise<void> {
    this.attempted.set(true);

    const divisionCode = this.divisionCode();
    const districtCode = this.districtCode();
    if (divisionCode === null || districtCode === null) return;
    if (this.form.invalid || this.store.submitting()) return;

    const { phone, name, preferredLanguage } = this.form.getRawValue();

    this.store.beginSubmit();
    try {
      const response = await this.farmers.registerFarmer$Response({
        // WEB-API-004 — the same key for every retry of this attempt.
        'Idempotency-Key': this.store.keyForAttempt(),
        body: {
          name: name.trim(),
          // Sent AS TYPED: the contract takes E.164 or BD national, so normalising here would
          // re-implement a server rule (WEB-NFR-001).
          phone,
          divisionCode,
          districtCode,
          preferredLanguage,
        },
      });

      // The number has done its job. It leaves the client at the first possible moment.
      this.form.controls.phone.reset('');

      const replayed = response.headers.get(REPLAYED_HEADER) === 'true';
      this.store.submitSucceeded(response.body, replayed);
      this.announcer.announce('farmers.register.announced', { name: response.body.name });
      this.registered.emit();
    } catch (error: unknown) {
      this.store.submitFailed(toProblemView(error));
    }
  }

  /** Clears the confirmation and hands back a blank form for the next farmer. */
  protected registerAnother(): void {
    this.form.reset({ preferredLanguage: APP_CONFIG.i18n.defaultLocale });
    this.attempted.set(false);
    this.store.resetRegister();
  }

  protected close(): void {
    this.registerAnother();
    this.closed.emit();
  }
}
