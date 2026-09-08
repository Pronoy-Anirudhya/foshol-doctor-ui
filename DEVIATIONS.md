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
