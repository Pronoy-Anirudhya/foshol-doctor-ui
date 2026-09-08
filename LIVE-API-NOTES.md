# Live API notes — verified against the running backend

Probed on 2026-09-08 against `http://localhost:8080` (profiles `local,demo`). **These are
observed facts, not guesses.** Where the running server disagrees with
`docs/openapi/foshol-api.yaml`, this file says so and `DEVIATIONS.md` records how we cope.

> Before trusting a 500 from this backend, check `tools/.run/app.log`. A stale JVM running an
> old jar produced `NoClassDefFoundError: AnalysisController$Caller` and made **every**
> `/analysis` and `/gradcam` call fail with 500. Restarting the stack fixed it. If analysis
> looks broken, restart before you redesign around it.

## Endpoints that match the frozen contract exactly

`POST /auth/otp/request` · `POST /auth/otp/verify` · `POST /auth/officer/login` · `GET /me` ·
`GET /crops` · `GET /crops/{cropId}/diseases` · `GET /diseases/{id}` ·
`GET /diseases/{id}/remedies` · `GET /symptoms` · `POST /cases` · `GET /cases` ·
`GET /cases/{caseId}` · `GET /cases/{caseId}/analysis` · `GET /cases/{caseId}/gradcam` ·
`GET /cases/{caseId}/advisory` · `GET /cases/{caseId}/advisories` · `GET /review/queue` ·
`POST /review/tasks/{id}/claim` · `/release` · `/symptoms` · `/approve` · `/reject` ·
`POST /advisories/{id}/revise` · `GET /stream`

Confirmed live values:

- `GET /cases/{caseId}/analysis` → **`thresholds: {"low":0.45,"high":0.75}`** and
  **`hasGradcam: true`**. This is the payload `WEB-NFR-011` requires the confidence bar to bind
  to, and it is present and correct. Do not hard-code thresholds.
- `POST /review/tasks/{id}/claim` → a contract-shaped `ReviewTask`:
  `{taskId, caseId, state, officerId, claimedAt, claimExpiresAt, slaDueAt, requeueCount, version}`.
  **Use this object for claim state and `expectedVersion`.**
- `POST /review/tasks/{id}/approve` → **201** with a contract-shaped `Advisory`.
  The server **derives `action`**: sending `APPROVED` came back as `EDITED`. Render the value
  the server returned; never assume the one you sent (`WEB-NFR-001`).
- `POST /review/tasks/{id}/symptoms` → **204**, no body.
- `POST /review/tasks/{id}/release` → **204 No Content**, NOT the contract's `200 ReviewTask`.
  The generated client therefore resolves to `null`; adopting it would blank the claim state and
  strand the officer. Ignore the body and re-read the case (see `DEVIATIONS.md` D-11).
- `GET /stream` → `text/event-stream`, heartbeat frames on the wire look like
  `:heartbeat\nid:1\n\n`. Per WHATWG a block carrying `id` but no `data` dispatches **no
  event** but **does** update `lastEventId`. The parser must handle that exact shape.

## Divergence 1 — `GET /review/tasks/{taskId}` is FLAT

The contract describes `{task, case, analysis, farmerName, suggestedDiseaseId,
suggestedRemedies, priorAdvisory}`. The server actually returns one flat object:

```
caseId, reviewTaskId, farmerName, cropCode, cropNameBn, districtCode, decisionPath,
topDiseaseId, topDiseaseNameBn, topConfidence, imageCount, hasAudio, analysisMode, state,
officerId, isResubmission, requeueCount, submittedAt, slaDueAt, top1Confidence,
top2Confidence, margin, candidates, symptoms, transcriptBn, asrConfidence,
gradcamObjectKey, images, audio, parentCaseId, suggestedRemedies, claimedBy,
claimExpiresAt, publishedAdvisory, version
```

Note especially: `gradcamObjectKey` (not `hasGradcam`), `claimedBy` (not `officerId` for the
claimant), `topDiseaseId` (not `suggestedDiseaseId`), **and no `thresholds` at all**.
Its `version` field is not the `ReviewTask.version` used for optimistic locking — the
flat object reported `2` where `claim` reported `0`.

**How to cope.** Do not build the officer workspace out of this response. Compose it from
endpoints that *do* match the contract:

| What you need | Where to get it |
|---|---|
| Case, images, note, audio ref | `GET /cases/{caseId}` → `CaseDetail` ✅ contract-shaped |
| Candidates, symptoms, transcript, **thresholds**, `hasGradcam`, mode, model meta | `GET /cases/{caseId}/analysis` → `AnalysisDetail` ✅ contract-shaped |
| Claim state and `expectedVersion` | the `ReviewTask` returned by `claim` / `release` ✅ |
| Queue row metadata (farmer name, SLA, resubmission) | `GET /review/queue` ✅ |
| Disease list / remedy prefill | `GET /crops/{cropId}/diseases`, `GET /diseases/{id}/remedies` ✅ |

Call `getReviewTask` through the **generated** client (so no URL is hand-written) only for
`suggestedRemedies`, `topDiseaseId` and `publishedAdvisory`, and map its flat body through one
clearly-marked adapter.

## Divergence 2 — `GET /admin/stats` is flat and differently named

Contract: `{casesToday, approvalRate, medianReviewSeconds, modelOfficerAgreementRate,
advisoriesPublished, casesRejected, pathCounts, thresholds:{high,low}}`.

Live:

```json
{"casesToday":0,"approvalRate":null,"medianReviewMinutes":null,"agreementRate":null,
 "agreementSampleSize":0,"confidenceHigh":0.75,"confidenceLow":0.45}
```

So: **`medianReviewMinutes`** not `medianReviewSeconds` (different unit — read the name),
**`agreementRate`** not `modelOfficerAgreementRate`, **`confidenceHigh`/`confidenceLow`** flat
rather than a `thresholds` object, plus an extra `agreementSampleSize`; and
`advisoriesPublished`, `casesRejected` and `pathCounts` are **absent**.

Nullable in practice: `approvalRate`, `medianReviewMinutes` and `agreementRate` are all `null`
until there is data. `WEB-FR-301` still requires the four tiles — render an honest "not enough
data yet" state rather than `0`, which would be a lie.

## Divergence 3 — `Remedy` identity field is inconsistent

`GET /diseases/{id}/remedies` returns remedies keyed `id`. The same objects nested inside
`suggestedRemedies` and `Advisory.remedies` are keyed **`remedyId`**. Read both:
`r.id ?? r.remedyId`.

## Presigned media

`GET /cases/{caseId}/images/{imageId}/url?variant=derivative` → **200**
`{"url":"http://127.0.0.1:9000/foshol-cases/…?X-Amz-…","expiresAt":"…Z"}`.
`GET …/content` → **302** to the same presigned URL. See `DEVIATIONS.md` D-02 for why the UI
uses `/url`.

## Demo data state

The seeded queue contains cases whose `CaseDetail.status` is still `ANALYSING` while their
review task is `PENDING`. That is pre-existing demo data, not a UI bug — render whatever the
server reports (`WEB-NFR-001`).

## Farmer path — verified end to end

```
POST /auth/otp/request  → 202 {"expiresInSeconds":300,"otpDeliveryMode":"DEV_FIXED"}
POST /auth/otp/verify   → 200 AuthResponse (principal.preferredLanguage = "bn")
POST /cases             → 202 {caseId,status:"SUBMITTED",submittedAt}
                          + `Location: /api/v1/cases/{caseId}`
GET  /cases             → 200 PageOfFarmerCaseRow ✅ contract-shaped
```

A freshly submitted case moves `SUBMITTED → ANALYSING → ANALYSED → IN_REVIEW` within a couple of
seconds on the `demo` profile (replay analysis, no sidecar needed) and lands with
`decisionPath: "PRIMARY"`. Drive the stepper from SSE, never a timer (`WEB-FR-356`).

### The 422 quality-gate body — matches the contract

Submitting `docs/demo/images/07-blurry-reject.jpg` returns **422**, nothing stored:

```json
{ "type": "https://foshol.local/problems/err-image-quality-rejected",
  "title": "Unprocessable Entity", "status": 422,
  "detail": "ছবি ঝাপসা। অনুগ্রহ করে স্পষ্ট করে আবার তুলুন।",
  "code": "ERR_IMAGE_QUALITY_REJECTED", "correlationId": "…",
  "errors": [{ "position": 0, "reason": "BLURRY", "field": "images[0]", "message": "BLURRY" }],
  "rejectedImages": [{ "position": 0, "reason": "BLURRY",
                       "messageBn": "ছবি ঝাপসা। অনুগ্রহ করে স্পষ্ট করে আবার তুলুন।" }] }
```

`rejectedImages[].messageBn` is present and carries a real Bangla sentence — **as the contract
says**. Render it verbatim (`WEB-UX-016`); it is better than anything the client could compose.

> **Correction.** An earlier revision of this file claimed the server sent `message` rather than
> `messageBn` here. That was wrong: it came from reading a truncated console dump and mistaking
> `errors[].message` — which really does carry the bare reason code `"BLURRY"` — for the
> `rejectedImages[]` entry beside it. The two arrays are different shapes. A client-catalogue
> fallback keyed on `reason` is still worth keeping for a rejection that arrives with no prose,
> but it is a fallback, not the normal path.

**Still true, and still a trap:** `rejectedImages[].position` is **0-based** while
`CaseImage.position` is **1-based**. Do not use one to index the other without adjusting.

## Auth failure status codes — the server does not use 401

Verified:

| Situation | Contract | Live |
|---|---|---|
| No `Authorization` header | 401 | **403** |
| Malformed or bad-signature JWT | 401 | **500** (`IdentityException: The token is not valid` escapes the filter) |
| Wrong OTP / wrong password | 401 | 401 ✅ |
| OTP requested too often | 429 | **429** ✅ with `Retry-After: 600` |

**What this means for the UI.** `WEB-FR-013` ("on 401, clear the session and return to that
surface's login") is implemented and correct, and it fires for the case that actually matters —
a rejected credential. But an **expired** token will surface as a 500, not a 401, so it will be
rendered as a generic error rather than bouncing the user to the login screen.

We deliberately do **not** work around this by treating 500 as a session loss: a genuine server
error would then silently log the user out, which is worse. The JWT TTL is 8 hours
(`foshol.auth.jwt.ttl`), so this cannot occur within a demo session. Recorded as a backend
blocker rather than papered over in the client (`WEB-NFR-001` — the frontend does not
re-implement, or second-guess, a backend rule).

## OTP rate limiting is real — mind it while testing

`foshol.auth.otp.rate-limit` is **3 requests per 10 minutes**. Exceeding it returns a proper
`429` with `Retry-After: 600`, which is exactly what `WEB-FR-011` renders. It also means a
scripted test loop will lock the farmer out for ten minutes; use the officer login when probing
something unrelated to farmer auth.

## A concurrency note from seeding

Submitting five cases at once produced one
`DataAccessResourceFailureException: An I/O error occurred while sending to the backend` in
`RunAnalysisCommandHandler`, leaving that case stuck in `ANALYSING` with no analysis row. It is
transient and load-related, not a code fault — the other four succeeded, and a lone resubmission
works. Submit demo cases one at a time.

---

## CORRECTION — the "audio cases fail analysis" finding was wrong

An earlier revision of this file reported that cases submitted **with audio** consistently failed
analysis, and pointed at the empty `sidecar/fixtures/embed/` directory. That was wrong on both
counts.

The real cause was a **stale JVM classpath**: the long-running backend process predated PR #6 and
was missing `com.rootcause.foshol.analysis.domain.SecondaryPathSpec` entirely. The event listener
threw `NoClassDefFoundError` mid-transaction, which aborted the transaction and dropped the JDBC
connection — producing the `DataAccessResourceFailureException: An I/O error occurred while
sending to the backend` and Postgres's `unexpected EOF on client connection with an open
transaction` that were mistaken for a database fault. Image-only cases failed the same way once
the drift was wide enough; audio was a coincidence of timing, not a cause.

See `BACKEND-BLOCKERS.md` B1. Every replay fixture referenced above is in fact present.

## BLOCKER (backend) — `GET /admin/stats` returns 500 as soon as there is data

**Reproducible.** With `admin`/`password`:

```
GET /api/v1/admin/stats → 500
```

`app.log` root cause:

```
ClassCastException: java.lang.Double cannot be cast to java.math.BigDecimal
  at ReviewQueryAdapter.lambda$loadStats$0(ReviewQueryAdapter.java:115)
  at ReviewQueryAdapter.loadStats(ReviewQueryAdapter.java:90)
```

`percentile_cont(...)` returns SQL `double precision`, so the row mapper's
`(BigDecimal) rs.getObject(...)` fails the moment `approval_rate`, `median_minutes` or
`agreement_rate` is non-null. It only appeared to work earlier because the demo database was
empty and every rate was `null` — which is why the shape recorded above under Divergence 2 is
the all-null one. **Approving a single case is enough to break it.**

Fix (owner: the `review` module, A5): use `rs.getBigDecimal(...)`, or map through `Number`, for
those three columns.

**Impact on the frontend.** The admin page is built and correct, but on stage it can only
demonstrate its `WEB-FR-305` stale-and-error path. That path is well built — last known values
are retained under a stale marker with the correlation id copyable — but it is not the beat you
want. Fixing three casts in the backend restores the whole admin beat.

`src/testing/fixtures/admin-stats-live-shape.json` holds the **correct** all-null body, not the
500 that was briefly captured there.

### CORRECTION — B2 is fixed, re-probed 2026-09-08

The blocker above no longer reproduces. `admin`/`password` against the running stack returns
**200 with every rate non-null** — the exact case that used to throw:

```json
{"casesToday":14,"approvalRate":0,"medianReviewMinutes":255.48561141666664,
 "agreementRate":1,"agreementSampleSize":7,"confidenceHigh":0.75,"confidenceLow":0.45}
```

The whole admin beat works. `BACKEND-BLOCKERS.md` B2 is updated to match.

Also verified in the same pass: **`GET /api/v1/review/queue` returns 200 for an ADMIN token** —
6 rows, all 19 fields including `topConfidence` and `decisionPath`. That is what the rebuilt
dashboard widgets are built on, since `/admin/stats` returns six scalars and the contract has no
time-series endpoint anywhere. Note the demo data is thin and clustered: 5 of 6 rows carry a
confidence and they all sit at 0.91–0.93, so a distribution drawn from it is one tall bar unless
a few mid- and low-confidence cases are seeded first.

---

## Field metrics and `computedDose` — verified 2026-09-08

Probed against `local,demo` on `:8080` with the seeded farmer and officer.

**`fieldArea` / `fieldAreaUnit` are genuinely required.** The body the previous client sent —
`cropId` + `images`, nothing else — now comes back:

```
POST /api/v1/cases  (no fieldArea)  → 400 ERR_BAD_REQUEST "The request could not be read."
```

Note the shape: it is a **plain `400`**, not a field-level `errors[]` array naming `fieldArea`.
Nothing in the response tells a client which part was missing, so the UI cannot render a useful
message from it. That is why the capture screen refuses to send without an area rather than
letting the server explain — there is nothing to explain with.

The same request with the two new parts:

```
POST /api/v1/cases  (fieldArea=2, fieldAreaUnit=DECIMAL, cropQuantity=40, cropQuantityUnit=KG)
  → 202 {"caseId":"…","status":"SUBMITTED","submittedAt":"…"}
GET  /api/v1/cases/{caseId}
  → {"fieldArea":2,"fieldAreaUnit":"DECIMAL","cropQuantity":40,"cropQuantityUnit":"KG",
     "metricsSource":"FORM", …}
```

So `CaseDetail` matches the contract, and `metricsSource` is `FORM` for a typed submission.
`SPEECH` / `FORM_AND_SPEECH` have not been observed yet — they need an audio case whose
transcript carries an area.

**`computedDose` is absent everywhere on the live stack today.** Across all six queued cases:

| decisionPath | suggestedRemedies | with `rateAmount` | with `computedDose` |
|---|---|---|---|
| UNDETERMINED | 0 | 0 | 0 |
| PRIMARY (×4) | 3 | 0 | 0 |
| PRIMARY | 0 | 0 | 0 |

The human-owned rate columns are null in the seed data, exactly as
`docs/frontend-demo-api.md` §8.2 warns ("often null until content-owner C15"), and with no rate
there is no dose. The officer console therefore renders **nothing** in the dose slot on the
current stack — not a zero and not a placeholder — and the populated case is covered by
`review-task-live-shape.json` instead. When C15 lands, the dose row appears with no code change.

**The flat review-task body still has no `case` object.** `docs/frontend-demo-api.md` §8.2 says
the task payload's `case` carries the field metrics. The live body's top-level keys are still the
flat list recorded under Divergence 1 — no `case`, and no `fieldArea` / `metricsSource` anywhere
on it. The console reads the metrics from `GET /cases/{caseId}` instead, which is how D-05
already composes the workspace, so nothing new is needed.
