# Deviations from the frozen contract

Every out-of-contract call, and every place the implementation departs from
`docs/requirements/70-frontend.ears.md`, with its reason and requirement id. Kept so the seams
stay visible (`00-common` §1.2) rather than becoming invisible habits.

---

## D-01 · OpenAPI version rewritten for generation

**What.** `scripts/sync-openapi.mjs` copies the frozen `docs/openapi/foshol-api.yaml` and
rewrites exactly one line: `openapi: 3.1.0` → `openapi: 3.0.3`. The frozen source is never
edited (it is owned by agent A1, `00-common` §12.1).

**Why.** The spec declares 3.1.0 but uses 43 OpenAPI-3.0-style `nullable: true` keywords, which
3.1 removed. A strict 3.1 parser drops them, and the generated client would then type 43
nullable fields as non-nullable — silent false confidence under `strictNullChecks`. With the
rewrite, `| null` is generated correctly on all 43. The script asserts that no other line
differs, so the transformation is verifiable and re-runnable.

**Requirement.** `WEB-NFR-005` (generate, never hand-edit) is preserved; `COMMON-NFR-043` is
preserved.

---

## D-02 · Out-of-contract media URL endpoints

**What.** `src/app/core/media/out-of-contract/media-url.service.ts` calls three endpoints that
exist in the running backend but are **not** in the frozen OpenAPI:

- `GET /api/v1/cases/{caseId}/images/{imageId}/url?variant=derivative|original`
- `GET /api/v1/cases/{caseId}/audio/url`

(`…/audio/content` is deliberately NOT used — `/audio/url` covers the same need with one fewer
cross-origin hop.)

**Why (images).** The documented `…/images/{imageId}/content` returns `302` to a presigned MinIO
URL on a different origin, and the API requires a bearer token that `<img src>` cannot carry.
Fetching with the header and following the redirect would make `WEB-SEC-003` compliance depend
on per-browser redirect header-stripping behaviour, and would hold a blob in memory per
thumbnail with no HTTP caching. The `/url` variant returns the presigned URL as JSON, which
binds straight to `<img [src]>` as a plain no-CORS subresource load: MinIO needs no CORS
configuration, and the JWT provably never leaves the API origin.

**Why (audio).** `WEB-FR-213` requires an officer audio player with the Bangla transcript
alongside. The frozen OpenAPI has **no** audio-content operation, and
`docs/handover/frontend-demo-api.md` §15 explicitly says to raise a blocker rather than invent
one. **This is that blocker, raised** — and the user directed that the demo beat should work,
so the live endpoint is used behind a clearly marked seam.

**Requirement.** Departs from `WEB-API-001` and `WEB-NFR-006`. Contained to one directory, one
service, with a banner in the file header. Every other call in the application goes through
`src/app/generated/`, which the `check:arch` lint enforces by refusing `HttpClient` injection
outside `core/http`, `core/media`, `core/sse` and `core/i18n`.

**Unblock.** Add these three operations to `docs/openapi/foshol-api.yaml` (owner: A1), then
delete this service and regenerate.

---

## D-03 · `hasGradcam` rather than `gradcamObjectKey`

**What.** `WEB-FR-211`/`WEB-FR-212` describe gating the Grad-CAM toggle on `gradcamObjectKey`.
The frozen schema carries `hasGradcam: boolean` instead; the client binds to that.

**Why.** `WEB-API-005` — where the generated client and the requirement table disagree, the
generated client wins and the discrepancy is recorded. Recorded here.

---

## D-04 · `COMMON-NFR-004` self-referential block

**What.** `COMMON-NFR-004` says the frontend agent is blocked while the token `22.1.5` appears
in `00-common.ears.md`. It still appears — but only because commit `2e2f89d` did a blind global
find/replace of `[PLACEHOLDER-ANGULAR-VERSION]` → `22.1.5`, which rewrote the requirement's own
body and the `§2.3` heading along with every real usage.

**Why not a block.** The requirement's intent is that a real, resolved, exact Angular version
exists. Angular **22.1.5** is real and is npm `latest`; it is pinned exactly in `package.json`
with no `^` or `~`, enforced by `scripts/check-pins.mjs`. Treated as a find/replace artefact,
not a live block.

---

## D-05 · `GET /review/tasks/{taskId}` returns a flat object

**What.** The frozen contract types `ReviewCaseDetail` as `{task, case, analysis, farmerName,
suggestedDiseaseId, suggestedRemedies, priorAdvisory}`. The running server returns one flat
object (full field list in `LIVE-API-NOTES.md`).

**Why it is not fatal.** Everything the officer workspace needs is available from endpoints
that *do* match the contract — `GET /cases/{caseId}`, `GET /cases/{caseId}/analysis` (which
carries the `thresholds` object `WEB-NFR-011` depends on), the `ReviewTask` returned by
`claim`, and the knowledge endpoints. The workspace is composed from those.

**How we cope.** `getReviewTask` is still called through the **generated client**, so no URL is
hand-written and `WEB-API-001` holds. Its response is mapped through a single marked adapter
that casts via `unknown`, used only for `suggestedRemedies`, `topDiseaseId` and
`publishedAdvisory`.

**Unblock.** Reconcile the backend response with the frozen schema, or update the schema
(owner: A1), then delete the adapter.

---

## D-06 · `GET /admin/stats` returns different field names and units

**What.** Live: `medianReviewMinutes`, `agreementRate`, flat `confidenceHigh` /
`confidenceLow`, plus `agreementSampleSize`. Contract: `medianReviewSeconds`,
`modelOfficerAgreementRate`, a `thresholds` object, plus `advisoriesPublished`,
`casesRejected` and `pathCounts` which the server does not send at all.

**How we cope.** Same pattern as D-05: the generated `getAdminStats` makes the call; one marked
adapter maps the live body. The three absent fields are simply not rendered — inventing them
would be worse. `WEB-FR-302` is still satisfied because the thresholds ARE present, just flat.

**Unblock.** Reconcile server and schema (owner: A1), then delete the adapter.

---

## D-07 · `Remedy` identity field is `id` or `remedyId` depending on context

`GET /diseases/{id}/remedies` returns `id`; the same objects nested in `suggestedRemedies` and
`Advisory.remedies` return `remedyId`. The UI reads `r.id ?? r.remedyId` behind one helper.

---

## D-08 · `POST /auth/otp/request` 202 body is untyped in the contract

**What.** The frozen OpenAPI describes the `202` with no schema, so `ng-openapi-gen` types it
`Promise<void>` and reads it as text. The server does send a useful body —
`{"expiresInSeconds":300,"otpDeliveryMode":"DEV_FIXED"}` — which `WEB-FR-011` needs to show the
farmer how long the code is valid for.

**How we cope.** `AuthFacade` calls `requestOtp$Response(...)` and parses `.body` defensively via
`unknown`, falling back to `APP_CONFIG.auth.otpTtlSeconds` when the body is absent or malformed
(`WEB-NFR-010` — prefer the runtime value, fall back to the mirrored constant). No hand-written
URL is involved, so `WEB-API-001` holds.

**Unblock.** Add the 202 response schema to `docs/openapi/foshol-api.yaml` (owner: A1) and
regenerate; the defensive parse then collapses to a typed read.

---

## D-09 · SSE parser is one notch more lenient than WHATWG

**What.** WHATWG says a block whose data buffer is empty dispatches no event. Our decoder still
dispatches when the block carries an **explicit `event:` name**.

**Why.** The `resync` and `reconnect` frames in `docs/handover/frontend-demo-api.md` §10 carry
`{}` and are semantically complete without a body. Dropping them would silently disable
`WEB-FR-358` (refetch the visible view after a gap). Anonymous empty blocks — which is what the
`:heartbeat\nid:N\n\n` frames are — still dispatch nothing, while correctly advancing
`lastEventId` so `Last-Event-ID` resume works.

## D-10 · How the queue decides to refetch rather than reorder

**What.** `WEB-FR-204` says an SSE event patches the affected row in place and never re-orders
locally, and that a change which *would* require re-ordering triggers a refetch of the current
page. The server's order (`REVIEW-FR-030`: state, then lowest confidence, then oldest) is not
reproducible on the client, so "would this change the order?" is necessarily a heuristic.

**Ours, stated plainly:** refetch when the case is absent from the current page, or when the new
status is terminal (`ADVISED` | `REJECTED` | `FAILED`); otherwise patch in place.
`QueueStore` exposes **no comparator and no sort method at all**, so the requirement cannot be
violated by a later edit — the worst a wrong heuristic can do is refetch too often.

---

## D-11 · `POST /review/tasks/{id}/release` returns 204, not `200 ReviewTask`

**What.** The contract types the response as `ReviewTask`. The running server returns **204 No
Content**. Verified twice.

**Why it matters.** The generated client resolves to `null`, and adopting that `null` as the new
task would blank the claim state and strand the officer with no way to re-claim the case they
just released.

**How we cope.** `OfficerFacade` awaits the call, **ignores the body**, and re-reads the case to
get authoritative state. A regression test covers it.

**Unblock.** Reconcile the server with the schema, or change the schema to 204 (owner: A1).

---

## D-12 · `WEB-FR-231` "modify step text" cannot be transmitted

**What.** `WEB-FR-231` says the remedy editor shall allow the officer to *modify step text*.
`PublishAdvisoryRequest` carries only `diseaseId`, `remedyIds`, `officerNoteBn` and
`expectedVersion` — there is **no field for edited step text**. The server stores a selection of
existing remedy rows, not new prose.

**What we built instead, and why.** Steps, dosage and pre-harvest interval render **verbatim and
read-only**; the officer chooses which human-written remedies go out, and the officer note —
labelled as the place changes belong — travels with the advisory.

Offering an editable step box would be actively harmful: an officer could type a corrected
dosage, watch it appear on screen, submit, and have the server discard it silently. The farmer
would then receive the original dosage while the officer believed they had changed it. That is
precisely the failure `COMMON-CON-003` exists to prevent — a wrong dosage is not a bug, it is
harm — so a control that cannot keep its promise is worse than no control.

**Unblock.** Either narrow `WEB-FR-231` to remedy *selection* plus the note, or add an
edited-steps field to `PublishAdvisoryRequest` **and** a place for the backend to persist it
(owner: A1 for the contract, A5 for `review`). Until one of those happens, this stays as built.

---

## D-13 · `app-config.ts` amended for the field-metrics bounds

**What.** `APP_CONFIG.intake.metrics` was added after Wave 0 — `fieldAreaMin/Max/Step`,
`cropQuantityMin/Max/Step` and `defaultFieldAreaUnit`. `app-config.ts` is otherwise frozen and a
change to it is an amendment request rather than an edit.

**Why.** The contract now makes `fieldArea` and `fieldAreaUnit` **required** multipart parts, so
the capture screen has to render two number inputs. `WEB-NFR-009` forbids a numeric literal in a
component, and `min`, `max` and `step` are numbers; they had nowhere else to live.

**How we cope.** No server property backs any of these. They shape the control and nothing else:
the client never rejects an area on them, and `WEB-NFR-010` still holds — the server's gate is
the decision of record. `defaultFieldAreaUnit` is `DECIMAL` (শতক) because that is the unit a
Bangladeshi smallholder measures a plot in.

**Unblock.** If `foshol.intake.*` ever publishes these bounds, mirror them here and mark the
constants fallback-only, the way `analysis.confidence*Fallback` already is.

---

## D-14 · The persisted draft now carries the field metrics

**What.** `WEB-DATA-020` names `cropId` and `noteBn` as the only two persisted draft fields.
`CaseDraftStore` now also persists `fieldArea`, `fieldAreaUnit`, `cropQuantity` and
`cropQuantityUnit`.

**Why.** `fieldArea` became a required part of every submission. A refresh that kept the crop and
the note but silently dropped the one newly-required field would leave the farmer staring at a
disabled submit button with no indication of what had gone.

**How we cope.** All four are typed-in scalars, so `WEB-DATA-021` — the rule that actually
matters, that image and audio **bytes** never reach web storage — is untouched. A metric is
written only once it has a value, so a draft the farmer has not reached the field step of
round-trips byte-identical to how earlier builds wrote it; and a draft persisted by an earlier
build restores with the metrics simply unanswered rather than being discarded.

**Unblock.** Widen `WEB-DATA-020` to "typed-in scalars" (owner: A1 for the requirement).

---

## D-15 · The vegetation override survives the server's hard non-crop reject

**What.** The server gate now refuses a non-crop photograph outright — `422` with
`rejectedImages[].reason = NOT_A_CROP`, nothing stored, and no override on that path. The
**client-side** vegetation heuristic still offers "send anyway" (`WEB-FR-124`).

**Why we kept it.** The client heuristic is a hue/saturation coverage guess with no model behind
it, and `WEB-FR-124` exists precisely because it is weak: it must never permanently block a
farmer whose valid photograph it misreads. Removing the override would let a client-side guess
become terminal, which is the opposite of what the requirement asks for.

**How we cope.** The override stops being an invitation. `farmer.capture.quality.help.NOT_CROP`
now says the server makes the final call, and a warning line above the button
(`farmer.capture.quality.sendAnywayWarning`) says the server will refuse a photograph with no
crop in it and that nothing will be stored. The server's own `NOT_A_CROP` rejection renders as a
named reason on the thumbnail with **no** override offered — the only forward move there is a new
photograph.

**Unblock.** If the client ever gets a real crop/not-crop model, revisit whether the local
verdict should become terminal (owner: A1 for `WEB-FR-124`).

---

## D-16 · A resubmission starts with the field area blank

**What.** `RejectionPanel` calls `CaseDraftStore.discard()` before navigating back to capture, so
a resubmission after a rejection begins with no field area, and the farmer re-enters it.

**Why.** `discard()` is the one cleanup path that revokes preview object URLs and clears the
persisted draft (`WEB-DATA-022`); carving the metrics out of it would mean two cleanup paths that
have to stay in agreement. And a resubmission is not necessarily the same plot — a farmer told
their photo was of the wrong crop may well be photographing a different field.

**Unblock.** If the demo shows this as friction, carry the metrics across the resubmit hop
explicitly rather than by exempting them from `discard()` (owner: C-farmer-view, C-capture).

---

## D-17 · `src/styles.css` and `app-config.ts` amended for the UI overhaul

**What.** Both files are integrator-only per `OWNERS.md` ("frozen after Wave 0"). The premium
overhaul amends both: `styles.css` gains an enriched paddy ramp, a teal accent, a sage neutral,
three slate steps, `focus-invert`, sixteen semantic aliases and six radius tokens;
`app-config.ts` gains `notifications` and `admin` blocks.

**Why.** The frozen-after-Wave-0 rule exists so parallel agents cannot collide on shared files
mid-wave, not to make the design system permanent. A palette with holes in every ramp, no radius
tokens and no semantic layer is exactly the thing an overhaul has to change, and `WEB-NFR-009`
forbids the alternative of scattering the new constants through components.

**How we cope.** The change is additive: **no token was removed and no name changed**, so every
existing `var(--color-*)` reference and every Tailwind utility still resolves. The semantic layer
is new surface area rather than a rename, so components migrate to it as they are touched instead
of in one flag day.

**Unblock.** None needed — this is the amendment, applied by the integrator between waves, which
is what `OWNERS.md` prescribes.

---

## D-18 · The contrast gate now resolves token aliases

**What.** `scripts/check-contrast.mjs` used to scrape `--color-x: #rrggbb;` with a regex. It now
follows a chain of `var(--color-*)` aliases to the hex it ends at, fails on a dangling or circular
alias, and says which of the two problems an unresolvable pair has.

**Why.** With a two-layer token system, `--color-primary: var(--color-paddy-600)` is not a hex.
The old scrape would have gated the ramp nobody writes and silently skipped the alias every
component writes — the precise drift the script exists to prevent, and a skipped pair looks
identical to a passing one in the report.

**How we cope.** `PAIRS` now names the semantic token wherever components write one. The gate
grew from 24 rows to 49, closing gaps that were live but ungated: `paddy-800` on `paddy-50` in
the success toast, `dawn-300` on `slate-900` in the SSE indicator, and the three chip borders.

**Unblock.** None. One judgement recorded: `dawn-300` on `dawn-100` is **1.49:1** and is gated at
1.4 as a "decorative floor", consistent with the existing `surface-3`/`surface-0` row at 1.2. The
toast border carries no meaning alone — the glyph, the tone and the text all say it first.

---

## D-19 · `--color-focus` is unusable on the console chrome

**What.** The focus ring `#0b63c5` clears 3:1 against every light surface but is only **2.69:1**
on `slate-800`. A new `--color-focus-invert` (7.6:1 on slate-800, 8.5:1 on slate-900) is swapped in
by a single base-layer rule keyed off `[data-chrome='console']`, which `AppShell` sets when the
signed-in role is OFFICER or ADMIN.

**Why.** This was a real `WEB-UX-041` / `WEB-UX-043` hole, not a new requirement. It had not bitten
only because nothing focusable had yet been placed inside a dark panel — and the rebuilt admin
dashboard puts widgets there.

**How we cope.** One rule, applied from the shell, so a widget author cannot forget it. Both
inverted pairs are gated in `check-contrast.mjs`.

**Unblock.** None.

---

## D-20 · Bulk approve and reject still claim each task first

**What.** `POST /review/tasks/bulk-approve` and `bulk-reject` are one request, but the console
still sends **N claims before the one bulk write**. Bulk *transfer* claims nothing.

**Why.** Each item in those two payloads carries an `expectedVersion`, and the only trustworthy
version is the one `claim` returns. The flat review-task body's `version` is not it — D-05 records
that it reported `2` where `claim` reported `0` on the same task — and there is no bulk-claim
endpoint. Sending `UNKNOWN_TASK_VERSION` would be putting a value in the lock field that we know
to be wrong, which is worse than the extra round trips: it would look like optimistic locking
while doing nothing.

**How we cope.** N claims + 1 write, down from the 2N of the sequential loop this replaced. A task
that cannot be claimed never enters the request and is reported as a `FAILED` item carrying the
server's own code; claims held by items that then fail are released quietly. Bulk transfer needs
none of this because it only ever acts on claims the caller already holds, and `expectedVersion`
is optional on `BulkTaskItem`.

**Unblock.** Either a bulk-claim endpoint, or make `expectedVersion` optional on the approve and
reject items so the server resolves the version it just read. Owner: A5 (`review`). Worth pairing
with **B7** — `expectedVersion` is currently accepted and ignored, so today these versions are
ceremony either way.

---

## D-21 · The KPI seed pulls `ReviewService` into the initial bundle

**What.** `core/sse/kpi-warning-seeder.ts` is instantiated eagerly by `provideSse()` and imports
the generated `ReviewService`. It is the only new eager import of a generated service — `core/` and
`shared/` otherwise reach for just `AuthService` (needed at login) and `AnalysisService`
(`core/media`). The production build now warns: **initial 513.40 kB against a 500 kB budget**
(the error threshold is 1 MB, so this is a warning, not a failure).

**Why it matters more than the number suggests.** Everything officer-shaped was lazy before this:
the whole review client arrived only when an officer opened the console. A farmer on a rural
connection now downloads the queue, claim, transfer, bulk and approve wrappers they will never
call, and farmers are most of this product's users.

**How we cope — for now, honestly rather than quietly.** The budget has deliberately **not** been
raised, because raising it would hide the regression rather than answer it. The likely fix is a
dynamic `import()` of `ReviewService` inside the seeder's fetch, so it resolves from the same lazy
chunk the officer routes already pull; the seeder only ever runs for an OFFICER or ADMIN, so
nothing a farmer does would load it.

**Unblock.** Make that change and measure it. It is unmeasured here because
`ng build --configuration production` aborts with SIGABRT in this environment — see the note in
`README.md` — so the fix could not be verified at the time of writing, and an unverified bundle
optimisation is a guess.

---

## D-22 · The farmer's capture screen is now a guided stepper

**What.** `features/farmer/capture/capture-page.ts` used to be one scrolling screen with four
numbered sections all visible at once. It is now a five-step guided deck — crop, photographs,
your field, describe it, review and send — rendered as a stack of cards by
`features/farmer/capture/capture-stepper.ts`.

**Why the old comment said not to.** The page's own doc comment argued: *"One screen, three
steps, no wizard: crop, photographs, description. A wizard would put the always-available text
box (`WEB-FR-140`/`141`) behind a 'next', and a degraded path that must be found is not a
degraded path."* That reasoning is still correct, and it is the constraint this change had to
satisfy rather than overrule. The user asked for a guided flow because the farmers using this
app may not read well enough to navigate a long form unaided — guidance is an accessibility
requirement here, not decoration.

**How `WEB-FR-140`/`141` stays true.** Navigation is not linear-only. An always-visible step
rail makes **every** step directly reachable at any point, and Send is enabled the moment the
draft is valid regardless of which card is showing. The description box is therefore never
behind a "next" — it is one tap away from anywhere, which is a shorter path than the scroll it
replaced. The stepper carries a comment stating this so the constraint is not quietly lost in a
later refactor.

**Requirement.** `WEB-FR-140`/`141` preserved by the free-navigation rail. `WEB-FR-100`/`110`–`146`
unchanged — the same panels, the same local quality gate, the same submit path.

---

## D-23 · Client-side speech: dictation pre-fill and spoken step guidance

**What.** Two uses of the browser's own Web Speech API on the capture stepper, both new:

- `capture/voice-guide.ts` — `speechSynthesis` reads each step's Bangla instruction aloud.
- `capture/land-speech.ts` + `capture/bangla-quantity.ts` — `SpeechRecognition` (`bn-BD`)
  transcribes the farmer describing their plot, and a local parser pre-fills `fieldArea`,
  `fieldAreaUnit`, `cropQuantity` and `cropQuantityUnit`.

**Why this departs from what was written.** `voice-recorder.ts` states plainly: *"There is **no
client-side ASR here**. Whisper runs server-side in the Python sidecar."* And
`field-metrics-panel.ts` notes that the farmer may state the figures in the voice note, that the
**server** decides which source it used, and that the panel *"never merges, overrides or
second-guesses the spoken value"*. Both statements were right about the submission path and both
remain true of it.

**Why this is not a re-implementation of a backend rule (`WEB-NFR-001`).** The pre-fill never
reaches the wire as a claim. It types into the same four inputs the farmer would have typed into
themselves, they can edit or clear every one of them, and the request body is unchanged — so the
server still receives ordinary form values and still decides `CaseDetail.metricsSource` entirely
on its own. Nothing about routing, severity, queue order or confidence is computed here. The
land recognition is transient: no audio from that step is attached to the submission, because
the case has a single audio slot and it belongs to the describe step's recording.

**Why client-side at all.** The frozen OpenAPI has no transcription operation — the transcript
only comes back on `AnalysisDetail` *after* a case is submitted, which is far too late to help
someone fill the form. A round trip does not exist to be used.

**How it fails safely.** Both features degrade to silence. Where `speechSynthesis` has no Bangla
voice, or `SpeechRecognition` is absent (it is Chromium-only and needs a network), the mic and
the listen control simply are not shown and the step is the ordinary typed form it was before.
The parser refuses rather than guesses: an unrecognised unit yields no unit, an out-of-range
value is dropped rather than clamped, and ambiguity yields nothing. `bangla-quantity.spec.ts`
covers those refusals, because a wrong pre-filled area would feed a wrong remedy dose.

**Requirement.** `WEB-NFR-001` preserved (no backend rule recomputed). `WEB-NFR-007` preserved —
the Web Speech API is a browser API, not a dependency. `WEB-FR-913` (client-side ASR) remains
formally out of scope; this is an input aid on one form, not a transcription feature.

---

## D-24 · The officer queue's order strings run ahead of the backend

**What.** `officer.queue.orderNote` and `officer.queue.orderNoteDetail` now tell the officer that
the newest cases come first. The frozen OpenAPI still says the opposite: *"Ordering is fixed by
the server (state, top_confidence ASC NULLS FIRST, submitted_at ASC) and is not
client-controllable."* The same applies to the admin submission-cadence caveat, which explained
the old ordering.

**Why.** The user is changing the ordering in the backend so that every persona's list reads
newest-first, and asked for the UI text to be brought in line now.

**What was deliberately NOT done.** No client-side comparator was added. `QueueStore` still has
no sort method, and the rows render in exactly the order received — re-sorting a server-paginated
list in the browser would reorder one page and quietly mislead about the rest, and it would
recompute a rule the server owns (`WEB-NFR-001`).

**Open until the backend lands.** Between this change and the backend change, the officer queue's
order note and its actual order disagree. Revert these two strings, or ship the backend ordering,
before this reaches anyone relying on it.

**Requirement.** `WEB-FR-200` — ordering stays server-owned and un-recomputed. `WEB-NFR-001`
preserved.

---

## D-25 · `app-config.ts` amended for farmer provision

**What.** `APP_CONFIG.farmers` was added after Wave 0 — `importMaxRows`, `importMaxBytes`,
`nameMaxLength`, `templateFilename`, `templateHeader` and `phonePattern`. `app-config.ts` is
frozen and a change to it is an amendment request rather than an edit. Same shape of amendment as
**D-13**, and for the same underlying reason.

**Why.** `WEB-FR-313` requires the bulk-import screen to state its caps as help text and to stop
an officer who has picked a file that cannot succeed. Those caps are numbers, and `WEB-NFR-009`
forbids a numeric literal in a component or service, so they had nowhere else to live.

`farmers.phonePattern` exists because `auth.phonePattern` could not be reused: it accepts
`+8801…` only, while `WEB-FR-311` requires the register form to accept the national `017…` form
as well — an officer types the number as the farmer says it.

**How we cope.** `importMaxRows` and `importMaxBytes` mirror `foshol.identity.bulk.*` and are
fallbacks in the `WEB-NFR-010` sense: the server validates every row and its answer is the
decision of record. A file inside these bounds may still be refused, and the UI shows the
server's per-row result when it is. The phone is likewise sent **as typed** — the contract
accepts either form, so normalising client-side would re-implement a server rule
(`WEB-NFR-001`), and `ERR_PHONE_INVALID` remains authoritative.

**Unblock.** If `foshol.identity.bulk.*` is ever published to the client, mirror it at runtime and
mark these constants fallback-only, as `analysis.confidence*Fallback` already is.

---

## D-26 · The farmer directory offers no sorting

**What.** The directory was asked for with "relevant filters/sorting options". It ships with the
filters and the pagination, and with **no sort control at all**.

**Why.** `listFarmers` has exactly four parameters — `page`, `size`, `q`, `phone`. There is no
`sort`, and the operation is specified as "farmers in the caller's district, **newest first**".
A client-side comparator was considered and rejected: it would reorder only the twenty rows
already fetched while presenting itself as having ordered the district, which is worse than
honest absence. It would also recompute a rule the server owns (`WEB-NFR-001`).

**How we cope.** `FarmerDirectoryStore` has no comparator, not even a private one — the same
enforcement-by-absence `QueueStore` uses. The screen states the order in words
(`farmers.directory.orderNote`) so that nobody hunts for a control that is deliberately missing.

**Unblock.** A `sort` parameter on `listFarmers` would be a contract change; until then this
stays as it is. The requester has been told.

---

## D-27 · A new shared primitive: `modal-dialog`

**What.** Register and bulk-import are modal dialogs, and the design system had no dialog. One
was added at `shared/ui/modal-dialog/`, built on the native `<dialog>` element and `showModal()`.

**Why.** The platform element supplies the focus trap, `Escape`-to-close, background inertness,
the top layer and focus restoration to the invoking control. A hand-rolled overlay would have to
re-implement all five and would plausibly get one wrong; `WEB-NFR-007` forbids reaching for a
library. `WEB-UX-040`/`041` are therefore met by construction rather than by vigilance.

**The one wrinkle.** jsdom implements neither `showModal()` nor, on this version, `close()`, so
the component falls back to toggling the `open` attribute when they are absent. That path exists
only for the test environment — both methods have been browser-baseline since 2022 — and it
degrades to a non-modal dialog rather than throwing.

**Not done.** No media query was added: the sheet-to-panel switch is Tailwind variants on the
elements themselves (`WEB-UX-034`). The component's stylesheet contains exactly one rule,
`::backdrop`, because a top-layer pseudo-element is unreachable by any utility class.

---

## D-28 · The import template is rebuilt client-side, BOM and filename included

**What.** `downloadFarmerImportTemplate` is declared `text/csv` with `type: string` and no
`format: binary`, so `ng-openapi-gen` generates a `responseType: 'text'` operation returning a
`string` rather than a `Blob`. The download is therefore assembled in the browser: the leading
BOM is stripped if present and exactly one is prepended, and the file is named from
`APP_CONFIG.farmers.templateFilename`.

**Why.** `IDENTITY-FR-024` requires the file to carry a UTF-8 BOM — without it Excel renders the
Bangla column values as mojibake, which is the whole reason the BOM is specified. A text-typed
response cannot preserve it as bytes, so it is re-applied. Stripping first is what stops a
double BOM (`ï»¿ï»¿`) appearing in the first column heading.

The filename comes from the constant rather than from `Content-Disposition` because that header
is not CORS-exposed on this origin, so the client genuinely cannot read it. The value is the
contract's own, quoted in the operation description.

**Verification note.** `Blob.text()` decodes as UTF-8 and the decode step **strips a leading
BOM**, so a text-based assertion cannot distinguish a file with a BOM from one without.
`farmer-csv.spec.ts` therefore asserts on the raw bytes (`EF BB BF`).

**Unblock.** Declaring the response `format: binary` upstream would generate a `Blob` and make
all of this unnecessary.

---

## D-24 update · the backend ordering has landed

`npm run api:sync` on 2026-09-10 brought in the queue ordering change D-24 was waiting for. The
frozen contract now reads *"Ordering is fixed by the server (submitted_at DESC, newest case
first) and is not client-controllable. Client `sort` and `order` query parameters are rejected."*

The officer queue's order strings and the backend therefore now agree, and **D-24 is closed** —
no string needs reverting. The generated `ReviewService` doc comments changed with the sync; that
is the whole of the diff, and no client behaviour changed. Still no comparator anywhere.

---

## D-29 · The phone lookup puts a phone number in a query string — `WEB-SEC-002` conflict

**BLOCKER-CLASS. Read this before shipping the farmer directory.**

**What.** `WEB-SEC-002` says the frontend *"SHALL NOT place a token, phone number, OTP code or
object key in a URL, query parameter or route fragment."* The frozen contract's own farmer
lookup is a query parameter:

```yaml
- name: phone
  in: query
  description: Exact phone lookup after E.164 normalisation. Never echoed. Must not be combined with q.
```

`WEB-FR-312` then requires the directory to offer that lookup. So a requirement and the contract
it is written against contradict each other, and `listFarmers` offers no other way to ask — there
is no search POST to fall back to.

**What we did.** Followed the generated client, as `WEB-API-005` directs (*"IF the generated
client and this table disagree, THEN THE frontend SHALL follow the generated client and THE agent
SHALL record the discrepancy as a blocker"*). This entry is that record.

**The exposure, stated precisely rather than reassuringly.** The number appears in the query
string of one `XHR`. It therefore reaches: the server's access log, the browser's devtools
network panel, and any intermediary proxy log. It does **not** reach the address bar, browser
history, a bookmark, a `Referer` header from a page navigation, or `localStorage` — the Angular
route carries no phone segment and no phone query parameter, and nothing persists it. That is a
narrower exposure than `WEB-SEC-002` is written to prevent, but it is not zero, and it is a real
deviation rather than a technicality.

**What was NOT relaxed.** No phone is ever rendered from a response — `FarmerRecord` has no phone
field, so the possibility was removed at the contract rather than left to the UI. The register
form's number is cleared the instant a submit succeeds. Nothing is logged (`check-architecture`
forbids `console.*`) and nothing is stored (`WEB-DATA-020` names the only two localStorage keys,
neither of which is this).

**Unblock — two ways, both backend-side.**
1. Accept the lookup as `POST /api/v1/farmers/search` with the number in a body, which is what
   `WEB-SEC-002` implies the shape should have been; or
2. Amend `WEB-SEC-002` to carve out the district-scoped staff lookup explicitly, so the
   requirement and the contract stop disagreeing.

Until one of those happens, the alternative available to the UI alone is to **drop the phone
lookup entirely**, which would forfeit the duplicate check `WEB-FR-312` added it for. The
requester chose to keep the lookup with this deviation recorded.

---

## D-22 update · Send is now gated to the review step

D-22 recorded that "Send is enabled the moment the draft is valid regardless of which card is
showing". That is **reversed**: Send unlocks only on the review step (`capture-page.ts`
`canSend`).

**Why.** A farmer who has not seen what is about to be sent cannot meaningfully consent to
sending it, and the old behaviour let a draft go the instant it happened to satisfy the minimum —
before the photographs had been checked or the field area confirmed. The requester asked for the
change directly.

**What D-22's argument actually protected, and still does.** That entry's `WEB-FR-140`/`141`
reasoning is about the **description box** being reachable at all times, not about Send. The
always-visible step rail is untouched: every step, review included, is one tap away from
anywhere, so the free-text description is no further behind a "next" than it was.

**One thing this exposed.** A `422` names the images it refused and marks them on the
photographs card. With Send moved to the review step, the farmer was being told an image was
rejected while looking at the one screen that shows no images — so a rejection now moves them to
the photographs step (`capture-page.ts`, submit's catch).

---

## D-30 · The standalone crop picker page is gone

`/farmer/new` was a standalone crop-picker page that navigated to `/farmer/new/capture`, whose
first step was *again* crop selection with the earlier choice pre-selected. The picker is
removed; `/farmer/new` now loads the stepper directly and `/farmer/new/capture` redirects to it
so older links still land somewhere sensible.

Nothing was lost: `CropGrid` — the actual picker UI — is unchanged and is what step one has always
rendered. `capture-page`'s back link returned to the picker and now returns to the case list
(`farmer.capture.backToCases`).

Safe because nothing required a crop to be chosen before the stepper opened: there was no guard,
no redirect and no effect on `new/capture`, and the stepper always opened on the crop step
regardless.

---

## D-31 · The OTP request no longer hides whether a number is a farmer

**What.** `POST /api/v1/auth/otp/request` used to answer `202` for every well-formed phone,
registered or not. It now answers `404` `ERR_FARMER_NOT_FOUND` when the number is not a registered
farmer, and the farmer login stays on the phone step rather than opening the OTP screen.

**Why this is recorded here even though the client now matches the contract.** The old behaviour
was not an accident, and this client was built to rely on it — `auth-facade.ts` carried a comment
stating that a failure "never says whether the number exists". Anyone reading that history needs to
know the property was withdrawn on purpose rather than lost.

`IDENTITY-FR-001` was rewritten to mandate the `404` and states the trade-off in its own words:
*"A distinguishable unknown-phone response lets callers enumerate seeded farmer numbers; that cost
is accepted so an unregistered number never reaches OTP."*

**What that costs, stated plainly.** The login is now an enumeration oracle: anyone may probe
numbers and learn which belong to registered farmers, rate-limited to 3 per 10 minutes per number
but not per caller. That sits oddly beside the lengths the farmer directory goes to — `FarmerRecord`
carries no phone field at all, and D-29 records a `WEB-SEC-002` conflict over a phone in a query
string. It is the identity module's call and it has been made; this entry exists so the two
decisions are visible together.

**Client-side consequence.** `WEB-FR-013` is untouched: `problem.interceptor` acts on `401` only,
and both OTP paths are in `PUBLIC_AUTH_PATHS`, so this `404` clears no session and triggers no
redirect. The 404 is displayed with the catalogue's Bangla copy rather than the server's `detail`,
because the identity module hardcodes that detail in English and negotiates no language — see
`features/auth/shared/auth-error-keys.ts`.

---

## D-22 update · Next is gated on the current step's required fields

D-22 recorded the capture deck as a guide rather than a gate. Two of its properties have now been
withdrawn on request, and this notes the second.

**What changed.** The deck's **Next** button is disabled while the step in front of the farmer is
missing something the submission actually needs. Three steps gate: crop, photographs, field area —
exactly what `CaseDraftStore.canSubmit` demands. A disabled Next is accompanied by a stated reason
(`farmer.capture.stepper.incomplete`) tied to the control with `aria-describedby`, because a dead
control with no explanation is worse than a live one that fails.

**What deliberately did NOT change: the rail stays free.** Every step remains reachable in one
press from any other, including while Next is blocked. That is not an oversight — it is what
`WEB-FR-140`/`141` require, and it is D-22's whole compliance argument: the free-text description
must be available at all times, so a farmer who has not yet chosen a crop must still be able to
reach the description box. Gating the rail would have satisfied "cannot progress" more literally
and broken a requirement doing it.

The practical consequence, stated plainly: a determined farmer can still reach a later step via the
rail without completing an earlier one. Nothing is lost by that — `canSubmit` is unchanged, Send
is still gated on both a valid draft and standing on the review step, and the server validates
independently. The gate is guidance made firmer, not a new invariant.

**Why "describe it" is not among the gated steps.** A description is optional on the wire —
`noteBn` and the audio part are both optional on `submitCase`, and `canSubmit` does not consider
them. It still ticks on the rail when answered; ticking and gating are now two separate inputs on
`CaptureStep` (`complete`, `required`) precisely so this step can do one without the other.

---

## D-32 · The farmer FAQ voice lookup, and the two frozen files it amended

**What.** A new farmer surface at `/farmer/faq` (`features/farmer/faq/**`), a first-class nav item
beside "new case", wired to the contract operations `voiceSearchFaq`, `listCrops`,
`listDiseasesByCrop` and `listRemedies`. Two frozen files were amended to carry it, and one new
interceptor was registered.

**Why it is not a second capture screen.** ADR-0003 keeps every field diagnosis on
`POST /cases` → officer → advisory. This path never submits a case, never publishes an advisory,
and never claims the farmer's own field has anything: it reads catalogue rows a farmer could
already reach by tapping through a disease list, using speech as a faster index into the same
public data. The disclaimer saying exactly that is persistent on the page rather than a toast, and
`faq-store.spec.ts` asserts by URL that no case endpoint is ever touched from this flow.

**The confirmation gate is the whole design.** `POST /faq/voice-search` returns ranked candidates
and — by the backend's own design — no remedy text. The UI holds that line: `FaqStore.confirm` is
the only method that calls `listRemedies`, and it runs only from a deliberate tap. Speech
recognition mishears, and the top candidate of a mishearing is still a confident-looking disease
name; auto-revealing its chemical dosage would be a safety defect, not a cosmetic one. Asserted
twice — at the store, and at the page.

**Amendment 1 — `core/config/app-config.ts`** gains a `faq` block: `requestTimeoutMs` (45 s),
`candidateSkeletonRows`, `diseaseFilterMinChars`. Precedent D-13, D-17, D-25. No server property
backs any of them; the timeout shapes one request and the other two shape a control.

**Amendment 2 — `app.config.ts`** registers `requestAttemptInterceptor` **first**, ahead of
`correlationIdInterceptor`. It reads two `HttpContextToken`s and does nothing otherwise, so every
other request in the application is untouched — asserted as the first case in its spec.

Two things forced that shape. `ng-openapi-gen` forwards exactly one caller-controlled value into a
generated call, an `HttpContext`, so a per-call timeout or header has nowhere else to live without
hand-building a request — which would mean hand-writing a URL (`WEB-API-001`). And ASR is slow
enough that "still working" and "never coming" look identical to a farmer holding a phone in a
field, so this one request needs a finite ceiling where the rest of the application deliberately
has none.

`correlationIdInterceptor` documents that the client never mints an id — it quotes back the last
one the server gave us so a submit → analyse → review chain shares one. That is right for a chain
and wrong for the start of one. A FAQ lookup is a new interaction on each attempt, and the id
printed on its failure panel has to belong to that attempt, so `ATTEMPT_CORRELATION_ID` lets the
caller supply one; the existing interceptor then sees the header already set and leaves it alone.

**Deviation from the brief, recorded.** The request asked for organic-versus-chemical tabs.
`Remedy['type']` has four values — `CULTURAL | ORGANIC | BIOLOGICAL | CHEMICAL` — so a two-way
split would either hide two categories or invent a mapping, and inventing an agronomic grouping is
`COMMON-CON-003`. The chemical rows get their own section because they are the ones carrying a
pre-harvest interval and a handling obligation; the other three keep their own icon and label
inside the non-chemical section. Server order is preserved within each.

**Not done, deliberately.** The Web Speech API is not used as a fallback recogniser. It is a
typing aid on the capture stepper (D-23); using it here would put a second transcriber in front of
the farmer whose output the backend never sees. When the microphone cannot work — an insecure
origin, a refused permission, no device, no supported container — or when the ASR sidecar answers
`503`, or when the match is inconclusive, the page falls back to the typed catalogue over
`GET /crops/{cropId}/diseases`, which none of those failures affect.

**Unblock.** Nothing is outstanding: the operation is in the frozen contract and the generated
client, so no hand-written URL exists anywhere in this feature.

---

## D-33 · Press-and-hold is the only way this application opens a microphone

**What.** The land step's dictation mic changed from tap-to-toggle to press-and-hold, so all three
voice controls now share one gesture. `SpeechRecognition.continuous` is `true` while held.
`APP_CONFIG.speech.listenTimeoutMs` is raised 12 s → 30 s. The button itself is extracted into
`shared/ui/hold-to-talk/`, which every voice surface now renders through.

**Why there is an entry at all.** No requirement governs this. `WEB-FR-130` mandates hold-only for
the **audio recorder**, and the describe and FAQ recorders already obeyed it. The land dictation is
Web Speech, which `WEB-FR-913` marks `[DEFERRED]` and out of scope, so its interaction was
specified nowhere and arrived with D-23 as an unspecified aid. Making it hold is a product decision
recorded here per "no requirement, no code". Nothing on the wire changes: the dictated audio still
never leaves the browser, the server still receives only the typed values and still decides
`CaseDetail.metricsSource` on its own (`WEB-NFR-001`).

**Why the copy did not need rewriting, only the control.** The Bangla already read
"মাইক চেপে বলুন" — *press and hold the mic*. The gesture had drifted from the words rather than the
other way round. The English said "Press the microphone", which described the tap, and is corrected
to "Hold" in `farmer.capture.land.speak` and `farmer.capture.field.help`.

**Why `continuous = true` does not contradict D-23.** D-23 set it `false` because "a continuous
recogniser on a phone in a field is an open microphone the farmer has no reason to expect". Under a
hold the microphone is open exactly while a finger is on the button, and closes on every one of
`PointerHoldDirective`'s six release paths plus a hidden page and `DestroyRef`. That is a *physical*
bound, and a stricter one than the model it replaces — the old toggle could hold the microphone for
a further 12 s after the farmer's last word. D-23 is amended, not overturned. The change is also
forced by the gesture: with `continuous = false` the engine ends at the first pause, so a farmer
who drew breath mid-sentence lost the rest while still visibly holding the button.

**Why the timeout survives, at 30 s.** It is no longer what normally stops a listen — the release
is — so it is demoted to a leak guard for an engine that never reports its own end. 30 s is
`intake.maxAudioSeconds`, so one hold means the same maximum everywhere in the application.
Expressing it as `maxAudioSeconds * msPerSecond` and deleting `listenTimeoutMs` was considered and
rejected: a value change is a smaller edit to a frozen file than a removal, and the spec asserts the
two are equal so they cannot drift apart silently.

**The release-before-start race, which the gesture introduced.** A quick press can call `stop()`
before the engine has acknowledged `start()`; stopping an engine that has not started either throws
or lets it start afterwards and stay open — an open microphone with no control on screen. `stop()`
now records the request and returns, and `onstart` applies it the moment there is an engine to
stop. A minimum-hold timer was rejected as a guess about engine latency on an unknown device. A
too-short press therefore yields an empty transcript, which the existing guard already discards, so
the farmer sees nothing happen rather than an error they cannot act on.

**Why a shared component rather than a written rule.** The three call sites duplicated the same
button shell, the same 24×24 glyph and about twenty lines of CSS each, and the drifted one was the
only mic in the app with **no accessible name at all** — its single child was `aria-hidden`. The
extracted `<foshol-hold-to-talk>` makes `labelKey` a required input, so that particular defect can
no longer be written; and there is no way to render a microphone through it without the gesture.
`OWNERS.md` is amended because the A-kit glob enumerates `shared/ui` directories by name, so a new
one would otherwise be owned by nobody.

**Cost, stated plainly.** The describe and land mics gain the FAQ recorder's pulsing held ring in
place of a static one — a deliberate visual change, disarmed by the global `prefers-reduced-motion`
rule, leaving the clay fill which still reads.

---

## D-34 · Catalogue content follows the language toggle

**What.** The knowledge catalogue now returns both locales in one payload — `Crop`, `Disease`,
`Remedy`, `SymptomRef` and `VoiceSearchCandidate` each carry `*Bn`, `*En` and a `*EnFallback`
flag. The client was regenerated and every catalogue binding now resolves through one helper,
`shared/pipes/content-locale.ts`, instead of reading `*Bn` directly.

**Why it is not a deviation so much as a debt being paid.** The toggle already switched all UI
chrome; it could not switch catalogue text because the wire had only Bangla. Disease names, crop
names and remedy titles stayed Bangla in English mode, which read as a half-finished feature
rather than as a deliberate content rule.

**The rule, in one place.** `pickContent` / `pickContentList` / `pickRemedyContent` decide:
Bangla renders the `*Bn` field unmarked, because Bangla is the language of record
(`COMMON-NFR-037`); English renders `*En`, and marks it `(bn)` when the server set the fallback
flag — `COMMON-NFR-038` says that value **is** the Bangla copied across, and `WEB-UX-015` says the
farmer must be told. A missing English side falls back to marked Bangla rather than a blank,
because inventing English is `WEB-UX-016`. Nothing is translated, concatenated, reformatted, or
digit-localised in the client.

**Two rendering forms, one core.** `<foshol-bn-value [bn] [en] [fallback]>` where a marker element
can exist — it also carries the accessible description — and the `contentText` pipe where one
cannot, which today is the admin crop filter's `<option>`. Both are driven by the locale as a
signal or a pure-pipe argument, so a toggle is a re-read: **no refetch**, and an in-flight FAQ
selection, candidate list and remedy list all survive it (`WEB-UX-012`). Verified in the browser
by counting requests across a toggle on three surfaces — the count did not move.

**Deliberately left Bangla-only**, because the contract has no English sibling for them:
`ExtractedSymptom.nameBn` and `Candidate.diseaseNameBn` on the analysis/review payloads,
`Advisory.diseaseNameBn` and `Advisory.officerNoteBn`, and the SSE notification `titleBn`. The
remedies **inside** an advisory do switch — `Advisory.remedies` is `{$ref: Remedy}`, which gained
the pairs — so the advisory card is bilingual in its catalogue rows and Bangla in its own prose.
That split is intentional and is the one judgement call in this change.

**A bug fixed on the way.** `POST /faq/voice-search`'s `preferred_language` was being bound to the
UI toggle. It is an **ASR hint** — the language the farmer is speaking — and a farmer reading the
interface in English still speaks Bangla into the microphone, so the toggle was able to hand
Whisper the wrong language and wreck a transcription. It is now the default locale, and a test
asserts it does not follow the toggle. The response carries both locales regardless of what is
sent, so nothing was gained by the coupling in the first place.

**Fields with no binding yet.** `Disease.descriptionBn/En`, `Remedy.rateNotesBn/En` and the whole
of `SymptomRef` are rendered nowhere in the app today. The helper serves them; no screen needed
changing.

---

## D-35 · The API origin is a deployment fact, not a compile-time one

**What.** `src/app/core/config/runtime-config.ts` resolves where the API lives, reading a global
that `/env.js` sets and falling back to `APP_CONFIG.api.origin` when the deployment has said
nothing. Five call sites moved onto it. The frontend now ships as a container whose nginx serves
the SPA and reverse-proxies `/api` to `BACKEND_API_BASE_URL` from an `.env` file.

**Why there is an entry.** Two files outside a feature glob changed. `app.config.ts` is frozen and
its `ApiConfiguration` provider now reads the accessor; `index.html` (A-kit) gains one classic
`<script src="env.js">`. `app-config.ts` itself is **untouched** — deliberately, because it is
`as const` and widening `api.origin` from a literal type to `string` would cascade `tsc` errors
through 25 spec files for no gain. A separate accessor chooses between the frozen value and a
deployment value, which is a different kind of fact from a constant.

**The bug this closes on the way.** `auth.interceptor.ts` captured the origin in a module-scope
`const`, evaluated at import. Had the real origin ever diverged from it, `isApiOriginUrl` would
return false for every API call and the four decorating interceptors would **silently stop
sending the bearer, `Accept-Language` and the correlation id** — no error, no log, just 401s.
Only `gradcam.service.ts` failed loudly. It is now resolved per call.

**Why a reverse proxy rather than an absolute cross-origin URL.** The backend's CORS allow-list is
`http://localhost:4200` and that repo is not ours to edit, so a cross-origin frontend could not
ship without someone else moving first. Same-origin also removes the preflight that every request
would otherwise pay (all of them carry `Authorization` + `X-Correlation-Id` + `Accept-Language`,
so none is a simple request), removes the mixed-content constraint, and removes the one failure a
container restart cannot fix: a browser-cached config file pinning the old backend.

**What the deployment must still get right**, all guarded at container start: `BACKEND_API_BASE_URL`
must be `scheme://host[:port]` with no path — a trailing slash makes nginx rewrite `/api/v1/cases`
to `/v1/cases` and every call 404s while the SPA loads perfectly. `Origin` is stripped upstream
because the browser now sends it on every POST; safe only because the JWT is a header and every
fetch uses `credentials: 'omit'`, so nothing ambient rides on it. `/api/v1/stream` gets its own
location with `proxy_buffering off` — `sse.timeoutMs` is 30 minutes with a 50 s stale watchdog, and
a buffering proxy turns a healthy stream into a silent reconnect loop.

---

## D-36 · Admins are shown no notification bell

**What.** `app-header.ts` gates `<foshol-notification-bell>` on the role — `FARMER` and `OFFICER`
only. An `ADMIN` session sees the SSE indicator, the language toggle and the account menu, and no
notification control, on `/admin/**` and on `/officer/**` alike.

**Why there is an entry.** `docs/frontend-demo-api.md` §10 addresses the `queue` event to
"Officer / admin", so a reader of the handover would expect an admin to have somewhere for those
frames to land. They no longer do. This is a product decision about the AUDIENCE, not a claim that
the event is misaddressed: the bell's rows speak about a farmer's cases and an officer's queue,
and an admin acts on neither. A control that sits permanently empty is worse than no control,
because an empty bell reads as "the stream is down".

**Decided by role, never by URL.** An admin is allowed onto `/officer/**` (`WEB-FR-001`), so a
path check would put the bell back the moment they opened the console. `app-header.spec.ts` pins
all four cases, including that one.

**What was deliberately NOT changed.** `#onKpi` still records for any non-farmer, and
`kpi-warning-seeder.ts` still seeds for `OFFICER` and `ADMIN`. So an admin's `NotificationStore`
still accumulates KPI rows behind a header that no longer renders them. That is accepted rather
than overlooked: the store is session-scoped and `clearSession` empties it at sign-out
(`WEB-SEC-004`), nothing reads it, and narrowing the two role lists as well would have put a
second, unrelated behaviour change into a UI-chrome commit. The bell is the surface; the surface
is what this entry removes.

**Requirement.** `WEB-FR-001` (chrome follows the JWT role) is preserved; `WEB-FR-354` /
`WEB-FR-357` are unaffected for the two roles they address.

---

## D-37 · The session survives a reload, in this tab's sessionStorage

**What.** `SessionStore` mirrors the session into `sessionStorage` under `foshol.session`: the JWT,
the principal the login returned, and its expiry. `restore()` reads it back once, from an app
initializer, before the router's first navigation, so a reload leaves the user where they were
instead of on the login. An entry whose JWT `exp` has passed is discarded rather than restored, as
is anything that fails a shape check. The JWT `role` claim still overrules the stored principal,
exactly as it does at login. Every sign-out path already runs through `SessionStore.clear()`, which
removes the entry: the account menu, a `401` from the API, and a `401` from the stream.

**Why there is an entry.** It reverses `WEB-SEC-001`, which kept the token in memory only and
accepted "a refresh is a new login" as the price. That price was paid on every reload on all three
surfaces. Two frozen files changed. `app.config.ts` gains the `provideAppInitializer`.
`scripts/check-architecture.mjs` replaces its single WEB-SEC-001 rule with two: the token pattern
may still not meet `localStorage`, and `sessionStorage` may not be referenced anywhere except
`session-store.ts` and its spec.

**Why sessionStorage and not localStorage.** Tab scope. `sessionStorage` survives a reload and dies
with the tab; `localStorage` is shared by every tab on the origin. Signing in as a farmer, an
officer and an admin in three tabs, which is the normal way to exercise this application, works
with the first and not with the second. With `localStorage` the last login would overwrite the
other two, and every tab would reload as that user. Tab scope also limits how long a token sits at
rest to the life of the tab rather than the browser profile. "Duplicate tab" copies
`sessionStorage`, so the copy is the same user; a new tab is a new login.

**The cost.** Before this change an XSS payload could act inside the page but could not read the
bearer. Now it can read the bearer from `sessionStorage` and carry it away, for at most the tab's
lifetime and the token's eight-hour `exp`. There is still no cookie, so there is still no CSRF
surface. `WEB-SEC-005` (no server string rendered as HTML) is what keeps such a payload out in the
first place, and it is unchanged.

**Why restore is an explicit call, not constructor work.** Sixteen spec files sign in, some with an
already-past expiry, and jsdom's `sessionStorage` outlives a single test. A constructor that
rehydrated would carry one test's session into the next. Only bootstrap calls `restore()`.

**The bug this surfaced.** A restored session makes requests at bootstrap: the SSE stream and the
KPI seed. If the server rejects the token before its `exp`, for example after a backend restart with
a new signing key, the `401` lands while the first navigation is still in flight and `Router.url` is
still `/`. `problem.interceptor.ts` picked the login from `Router.url`, so it sent an officer to the
farmer login and retained `/` as the route to restore. Until the first navigation completes, it now
reads the in-flight navigation's URL instead, the same way `authGuard` already does.

**What was deliberately NOT changed.** Mid-session expiry is still the server's to enforce. The
first request after `exp` draws a `401`, which clears the session and returns the user to that
surface's login with the attempted URL retained (`WEB-FR-013`). No client timer was added. The
retained intended URL is not persisted. `APP_CONFIG.storageKeys` is untouched, because it lists the
localStorage keys and this key belongs to `SessionStore`.

**Requirement.** `WEB-SEC-001` is amended as above. `WEB-SEC-002` (the token is sent only as a
header), `WEB-SEC-003` (and only to the API origin) and `WEB-SEC-004` (sign-out clears everything)
hold unchanged.
