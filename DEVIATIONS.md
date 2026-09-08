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
