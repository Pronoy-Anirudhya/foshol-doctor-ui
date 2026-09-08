# Backend blockers found while building this frontend

**Status: B1, B2, B3 (partially) and the SSE gap are FIXED as of 2026-09-08.** What remains open
is the audio-analysis race. Each item below now records what was found, and what happened.

Everything here is in `foshol-doctor` backend modules, not in this repo. Each was reproduced
against the running stack; none is worked around in the client, because a frontend that
second-guesses a backend rule ends up lying about it (`WEB-NFR-001`).

---

## RESOLVED · The Spring bean cycle (was B1)

The CQRS bus introduced in PR #6 created a constructor-injection cycle that stopped the
application starting from a clean build. **Fixed.** Verified: the stack starts, and the full
pipeline runs `SUBMITTED → ANALYSING → ANALYSED → IN_REVIEW` with `decisionPath: PRIMARY`.

## RESOLVED · Review error mapping (was part of B3)

Module `@RestControllerAdvice` classes are now `@Order(HIGHEST_PRECEDENCE)` so they beat the
global catch-all. Verified against the running server:

| Case | Before | Now |
|---|---|---|
| Advisory that does not exist | 500 `ERR_INTERNAL` | **404 `ERR_ADVISORY_NOT_FOUND`** |
| Remedy not belonging to the diagnosis | 500 `ERR_INTERNAL` | **400 `ERR_REMEDY_DISEASE_MISMATCH`** |

## RESOLVED · Officer queue SSE events

`HandleCaseStatusChanged` now emits the queue event in a `finally`, so it fires even when farmer
delivery fails. Verified on the wire:

```
event:queue
id:2
data:{"correlationId":"…","toStatus":"ADVISED","caseId":"01a07d2b-f51e-…"}
```

That matches the handover §10 contract exactly. The console reacts to it by refetching the
current page — a client-side gap this uncovered, fixed in `96c1b6b`.

---

## B2 · `GET /api/v1/admin/stats` returns 500 once any rate is non-null

```
ClassCastException: java.lang.Double cannot be cast to java.math.BigDecimal
  at ReviewQueryAdapter.lambda$loadStats$0(ReviewQueryAdapter.java:115)
```

`percentile_cont(...)` returns SQL `double precision`; the row mapper casts to `BigDecimal`. It
looked healthy only while the demo database was empty and every rate was `null` — **approving a
single case is enough to break it**.

Fix: `rs.getBigDecimal(...)`, or map through `Number`, for `approval_rate`, `median_minutes` and
`agreement_rate`. Owner: A5 (`review`).

**FIXED — re-probed 2026-09-08 during the UI overhaul.** With `admin`/`password` against the
running stack the endpoint now returns **200 with non-null rates**, which is precisely the case
that used to throw:

```json
{"casesToday":14,"approvalRate":0,"medianReviewMinutes":255.48561141666664,
 "agreementRate":1,"agreementSampleSize":7,"confidenceHigh":0.75,"confidenceLow":0.45}
```

So the admin page can demonstrate its real values, not only the `WEB-FR-305` stale-and-error path.
The new dashboard widgets are nonetheless sourced from `GET /review/queue` rather than from here —
not out of distrust, but because `/admin/stats` returns six scalars and the queue returns the
distribution the widgets actually need. Two independent reads also mean neither endpoint failing
can blank the whole page.

---

## STILL OPEN · Cases submitted with audio never finish analysis

Reproduced on the fixed backend: an image-only case reaches `IN_REVIEW`, while the same
submission plus `docs/demo/audio/secondary-brown-spot.wav` sticks in `ANALYSING` for ever and
`GET …/analysis` returns 404.

The log shows Hikari marking the connection **broken** ~29 ms in, while a second async task is
mid-query on `KnowledgeReadAdapter.findDiseaseById`, followed by
`Closing shared session with unprocessed transaction completion` and
`Application exception overridden by rollback exception`. Postgres logs nothing new and the pool
is healthy, so this is a client-side race between two concurrent tasks — one closing a
connection the other is still using. The audio path (ASR → embedding → pgvector) does more work
and widens the window, which is why it fails reliably and image-only cases do not.

**Correction to an earlier revision of this file:** this was at one point attributed to the
stale-classpath problem and retracted. That retraction was wrong. Retested on a clean build with
the cycle fixed, the audio-specific failure is real and reproducible.

## STILL OPEN · Auth failures do not use 401

| Situation | Contract | Live |
|---|---|---|
| No `Authorization` header | 401 | **403** |
| Malformed or expired JWT | 401 | **500** (`IdentityException` escapes the filter) |
| Wrong OTP / wrong password | 401 | 401 ✅ |

`WEB-FR-013` (on 401, clear the session and return to that surface's login) is implemented and
fires correctly for a rejected credential. An **expired** token, though, surfaces as a 500 and is
rendered as a generic error instead of bouncing the user to the login screen.

Deliberately not worked around: treating 500 as a session loss would silently sign a user out on
any genuine server error, which is worse than the gap. The JWT TTL is 8 hours, so it cannot occur
inside a demo session.

---

## B4 · Contract-vs-server divergences

Full reproductions in `LIVE-API-NOTES.md`; the coping strategy for each is in `DEVIATIONS.md`
(D-01…D-12). The load-bearing ones:

| # | What |
|---|---|
| D-05 | `GET /review/tasks/{taskId}` returns a **flat** object, not the contract's nested `{task, case, analysis}`, and carries no `thresholds`. The console composes the workspace from contract-shaped endpoints instead. |
| D-06 | `GET /admin/stats` uses `medianReviewMinutes` (a different **unit**), `agreementRate`, and flat `confidenceHigh`/`confidenceLow`; `advisoriesPublished`, `casesRejected` and `pathCounts` are absent entirely. |
| D-11 | `POST /review/tasks/{id}/release` returns **204**, not `200 ReviewTask`. Adopting the generated client's `null` would blank the claim and strand the officer. |
| D-02 | The frozen OpenAPI has no image `/url` and no audio operation at all, so presigned media uses two live-but-undocumented endpoints, quarantined behind one banner-marked service. |
| D-08 | The OTP `202` has no response schema, so the generated client types it `void` and the real body survives only via a defensive parse. |
| D-07 | `Remedy` is keyed `id` from `/diseases/{id}/remedies` but `remedyId` when nested in `suggestedRemedies` and `Advisory.remedies`. |

Adding the three media operations, the OTP 202 schema, and reconciling D-05/D-06/D-11 would let
`core/media/out-of-contract/` and two adapters be deleted outright.

---

## B5 · `WEB-FR-231` cannot be satisfied as written

The requirement says the remedy editor shall let the officer *modify step text*.
`PublishAdvisoryRequest` carries only `diseaseId`, `remedyIds`, `officerNoteBn` and
`expectedVersion` — there is nowhere to put edited prose, and nowhere for the server to persist it.

An editable step box would let an officer type a corrected dosage, watch it appear on screen,
submit, and have the server discard it silently. The farmer would then receive the original
dosage while the officer believed they had changed it. That is exactly the failure
`COMMON-CON-003` exists to prevent — a wrong dosage is not a bug, it is harm — so the console
renders steps, dosage and PHI **read-only**, and the officer note is labelled as where changes go.

Either narrow the requirement to remedy *selection* plus the note, or add a field **and** a place
to store it. See `DEVIATIONS.md` D-12.

---

## Demo data notes

- No seeded case has audio, so `WEB-FR-213` was unexercised until cases were submitted by hand.
- Several seeded cases have image rows whose MinIO objects 404; the UI degrades to a text
  placeholder rather than a broken-image glyph, but a queue of placeholders is a poor demo.
- The seeded Grad-CAM PNG is a **1×1, 69-byte placeholder**, so the overlay mechanism is real but
  there is nothing to see.
- The OTP rate limit was raised to **30 requests per 10 minutes**, which is comfortable for
  scripted testing. It is still enforced, so a tight loop can still trip it.
- **Replay vs the UI.** `WEB-FR-112` requires the client to re-encode every image, which is what
  strips GPS — so the uploaded bytes differ from the demo file and their SHA-256 misses the
  replay fixture. A case submitted through the Angular app is therefore `UNDETERMINED`, while a
  byte-exact submission (`call-api.sh`) gets `PRIMARY`. That is not a fault on either side; it is
  the privacy requirement and fixture-keyed replay pulling in opposite directions, and
  `UNDETERMINED` still routes to an officer, which is demo beat 8.
- **Live mode does not yet exist in the sidecar.** `sidecar/app/vision.py` implements
  `classify_live_unavailable()` (its own docstring says "replay serving, and live-mode
  unavailability"), startup hard-codes `models_loaded = 0` with `"weights not loaded"`, and
  `requirements.txt` carries no torch, transformers, faster-whisper or sentence-transformers.
  Starting the sidecar with `FOSHOL_AI_MODE=live` yields `status: DOWN` and a 503 on every
  request, so `FOSHOL_SPRING_PROFILES=local` would make **every** case `UNDETERMINED`. Until
  weights are wired in, `local,demo` (replay) is the profile that makes beats 4–7 work.

---

## B6 · No bulk approve / reject endpoint

**What.** The officer console now offers multi-select with bulk approve and bulk reject. The
frozen contract has only the single-task writes:

```
POST /api/v1/review/tasks/{taskId}/approve
POST /api/v1/review/tasks/{taskId}/reject
```

Checked against both `openapi/foshol-api.yaml` and the upstream
`foshol-doctor/docs/openapi/foshol-api.yaml`: there is no bulk, batch or multi-task operation
anywhere in the contract.

**How the client copes meanwhile.** The UI drives the existing per-task endpoints **sequentially**
and reports a per-row outcome, because partial failure is the normal case rather than the
exception — a `409` simply means another officer reached that task first. It is honest and it
works today, but it is N round trips where one would do, each approve costing a claim, a task
read and a write, and it cannot be atomic: a bulk of ten that fails at the seventh leaves six
advisories published.

**What the endpoint would need to carry.** Stated so the client can swap to it by changing one
facade method rather than a screen:

- The **task ids**, and per task the `expectedVersion` the client holds — optimistic locking is
  the only thing stopping two officers publishing the same advisory twice, so a bulk call that
  drops it would be a regression, not a shortcut.
- For approve: the `diseaseId` and `remedyIds` per task. They differ per case, so this cannot be
  one disease applied to many — a bulk approve that published one disease across a selection
  would be authoring agronomic content, which `COMMON-CON-003` forbids outright.
- For reject: one `reasonCode` and one `messageBn` may reasonably apply to the whole selection.
- **A per-task result array, not a single status.** Partial success is the expected outcome, and
  an all-or-nothing 4xx would leave the officer unable to tell which cases went out.

**Owner:** A5 (`review`). Until it lands the console behaves correctly; it is slower and
non-atomic, and the UI says so rather than implying otherwise.

**RESOLVED.** `POST /review/tasks/bulk-transfer`, `bulk-approve` and `bulk-reject` shipped, and
they answer `200` with the per-task result array this entry asked for — partial success is
modelled rather than collapsed into one status. The console now calls them instead of looping the
single-task writes; the single-task endpoints stay for the per-row actions.

---

## B7 · `expectedVersion` is accepted but not enforced

**What.** Both write endpoints take an `expectedVersion` and the frozen contract documents a
`409` for a stale one, but the server does not check it.

**Reproducible.** With `officer`/`password` against a `PENDING` task:

```
POST /api/v1/review/tasks/{id}/claim   → 200, version = 0
POST /api/v1/review/tasks/{id}/reject  { expectedVersion: -5, … }   → 200
```

`-5` is not merely stale, it is impossible, and the rejection was still recorded. Verified twice,
independently.

**Why it matters.** Optimistic locking is the only thing standing between two officers and two
conflicting decisions on one case. The console is built to hold the line — it sends the version
`claim` returned, and `WEB-FR-235` handling refreshes the case and preserves the editor on a
`409` rather than retrying — but with the check absent, the last write simply wins and the first
officer is never told. That is now more exposed than it was: the queue offers inline and bulk
approve/reject, so two officers working the same district can act on the same row in the time it
takes to open a confirm.

**What the client does about it.** Nothing, deliberately. Re-implementing the check here would be
guessing at a rule the server owns (`WEB-NFR-001`), and a client-side lock protects nobody once
there are two clients. The `409` path is implemented and correct; it simply never fires today.

**Fix:** compare `expectedVersion` against the persisted row and answer `409` when they differ,
in `approve`, `reject` and `revise`. Owner: A5 (`review`).


---

## B8 · The running stack predates the KPI work

**What.** Not a code defect — an operational note, recorded because it cost an afternoon to
diagnose and will cost the next person the same.

The KPI contract, the Java sources and migration `V108__review_kpi_and_transfer.sql` are all
present in the backend repo and compiled into `app/build/resources/main/`. The **process listening
on :8080 is an older build**, so every new endpoint is routed but blows up underneath:

```
GET /api/v1/review/officers       → 500 ERR_INTERNAL
GET /api/v1/review/kpi-warnings   → 500 ERR_INTERNAL
GET /api/v1/admin/kpis            → 500 ERR_INTERNAL
GET /api/v1/admin/kpis/breaches   → 500 ERR_INTERNAL
```

and `GET /review/queue` rows carry neither `assignmentDueAt` nor `resolutionDueAt`.

A **500 rather than a 404** is the tell: the routes are mapped, so this is not a missing feature —
it is a stale process against a database that never ran V108.

**Fix:** restart the stack (`./tools/start-stack.sh`) so the migration applies and the new
handlers load.

**What the client does about it.** Both KPI due instants are nullable on the contract anyway, so
every clock renders nothing rather than `Invalid Date` when they are absent, the bell still works
from live frames when its seed fetch fails, and the admin dashboard keeps the existing
`WEB-FR-305` stale-and-error behaviour. The console is therefore correct against both the old and
the new server — but nothing KPI-shaped can be demonstrated until the restart.
