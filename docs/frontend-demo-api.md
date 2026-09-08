# Frontend handover — APIs for a demo-capable UI

**Audience:** Angular frontend (separate application). **Purpose:** build the farmer app, officer
console and read-only admin stats page so a local demo works end to end **without inventing
endpoints**.

This file is self-contained for day-to-day UI work. The frozen contract remains
[`docs/openapi/foshol-api.yaml`](../openapi/foshol-api.yaml). Generate the HTTP client with
`ng-openapi-gen` into the frontend's generated client folder and **regenerate rather than hand-edit**
(`WEB-NFR-005`). If a field you need is missing from that file, raise a blocker — do not invent a
URL (`WEB-NFR-006`).

Angular pin: **22.1.5**. State: Angular **signals** only (no NgRx). i18n: **ngx-translate**, default
locale `bn`. The frontend **renders** server decisions; it does not recompute routing, queue order or
severity.

---

## 1. How to talk to the API

| Item | Value |
|---|---|
| Base URL (local) | `http://localhost:8080` |
| Angular origin | `http://localhost:4200` (CORS allow-list includes this) |
| Auth | `Authorization: Bearer <jwt>` on every `/api/v1/**` call except auth |
| Correlation | Send `X-Correlation-Id` when continuing a flow; echo the value from responses (`WEB-FR-006`) |
| Language | `Accept-Language: bn` or `en` matching the UI toggle |
| Errors | `application/problem+json` (RFC 9457). Show `title`, `detail`, and a copyable `correlationId` |
| Instants | All timestamps are UTC. Display in **`Asia/Dhaka`** |
| JWT storage | **Memory only** (`SessionStore`). Never `localStorage` / cookies / URL (`WEB-SEC-001`) |
| Presigned media | Follow `302` to MinIO. **Do not** attach the JWT to that host (`WEB-SEC-003`) |
| SSE | `GET /api/v1/stream` with **`fetch`**, not `EventSource` (cannot set `Authorization`) |
| Polling | **Forbidden.** Live updates come from SSE; otherwise a manual refresh control |

Public (no bearer): `POST /api/v1/auth/otp/request`, `POST /api/v1/auth/otp/verify`,
`POST /api/v1/auth/officer/login`. Health `GET /actuator/health` is not part of the product UI.

Exposed response headers you may read: `Location`, `Idempotency-Replayed`, `X-Correlation-Id`,
`Retry-After`.

Start the API with `./tools/start-stack.sh` (profiles `local,demo`). See the repo `README.md`.

---

## 2. Actors and demo credentials

One SPA, three route groups (`WEB-FR-001`):

| Actor | Role claim | Routes | Login |
|---|---|---|---|
| Farmer | `FARMER` | `/auth/**` then `/farmer/**` | Phone OTP |
| Field officer | `OFFICER` | `/officer/**` | Username / password |
| Admin | `ADMIN` | `/officer/**` and `/admin/**` | Same login endpoint, different user |

Seeded on `local` and `demo` (`V100`):

| Actor | Credentials |
|---|---|
| Farmer | Phone `+8801711111111`, OTP `123456` (dev-fixed) |
| Officer | `officer` / `password` |
| Admin | `admin` / `password` |

JWT claims (HS256): `iss` = `foshol-doctor`, `sub` = principal UUID, `role` ∈
`FARMER` \| `OFFICER` \| `ADMIN`, `iat`, `exp` (TTL **8 hours**). Read `role` from the token (or from
`principal.role` on login), **never from the URL**.

On any **401**: clear session, close SSE, return to that surface’s login, keep the intended URL.

---

## 3. Demo knowledge IDs (stable UUIDs)

Use **`GET /api/v1/crops`** (and nested disease/remedy calls) at runtime. Hard-coding is only for
fixtures and the PRIMARY rice-blast beat.

| Resource | `id` | `code` |
|---|---|---|
| Rice | `01800000-0000-7000-8000-000000000001` | `rice` |
| Tomato | `01800000-0000-7000-8000-000000000002` | `tomato` |
| Potato | `01800000-0000-7000-8000-000000000003` | `potato` |
| Rice blast | `01800000-0000-7000-8000-000000000103` | `blast` |
| Rice brown spot | `01800000-0000-7000-8000-000000000101` | `brown_spot` |
| Demo farmer | `01800000-0000-7000-8000-000000000201` | — |
| Demo officer | `01800000-0000-7000-8000-000000000202` | username `officer` |
| Demo admin | `01800000-0000-7000-8000-000000000203` | username `admin` |

Blast cultural remedy (typical prefill): `01800000-0000-7000-8000-000000000507`. **Always prefer
`suggestedRemedies` on the review-task payload** over this constant.

Capture files:

| Beat | Files under `docs/demo/` |
|---|---|
| PRIMARY | `images/01-rice-blast-primary.jpg` |
| SECONDARY | `images/02-rice-brown-spot-ambiguous.jpg` + `audio/secondary-brown-spot.wav` |
| Quality reject | `images/07-blurry-reject.jpg` (expect **422**, nothing stored) |

All remedy copy is **DEMO ONLY**. Render `stepsBn`, `dosageBn`, `phiDays` as returned. Do not
translate agronomic strings in the client (`COMMON-CON-003`).

---

## 4. Shared error body

```json
{
  "type": "https://foshol.local/problems/err-example",
  "title": "Bad Request",
  "status": 400,
  "detail": "Human-readable explanation.",
  "code": "ERR_EXAMPLE",
  "correlationId": "01a07caa-d705-7ad0-a51b-f334668c9f99",
  "errors": [{ "field": "phone", "message": "must be E.164" }]
}
```

`429` may include `Retry-After` (seconds). Quality failures on submit use `QualityGateProblem` with
`rejectedImages[].reason` ∈ `BLURRY` \| `UNDEREXPOSED` \| `OVEREXPOSED` \| `TOO_SMALL` \| `UNREADABLE` \|
`NOT_A_CROP`.

---

## 5. Authentication (all actors)

### 5.1 Farmer — request OTP

`POST /api/v1/auth/otp/request` — no bearer.

```http
POST /api/v1/auth/otp/request
Content-Type: application/json

{"phone":"+8801711111111"}
```

**202** (challenge created if the phone is known; do not leak whether the number exists):

```json
{ "expiresInSeconds": 300, "otpDeliveryMode": "DEV_FIXED" }
```

(`otpDeliveryMode` is a live extra vs a minimal OpenAPI description of 202.) **400**, **429**.

### 5.2 Farmer — verify OTP

`POST /api/v1/auth/otp/verify` — no bearer.

```json
{ "phone": "+8801711111111", "code": "123456" }
```

**200** `AuthResponse`:

```json
{
  "token": "<jwt>",
  "expiresAt": "2026-09-08T00:19:26.293678Z",
  "principal": {
    "id": "01800000-0000-7000-8000-000000000201",
    "name": "Demo Farmer",
    "role": "FARMER",
    "districtCode": "DHA",
    "divisionCode": "DHK",
    "districtNameBn": "ঢাকা",
    "districtNameEn": "Dhaka",
    "divisionNameBn": "ঢাকা",
    "divisionNameEn": "Dhaka",
    "preferredLanguage": "bn"
  }
}
```

**400**, **401**.

### 5.3 Officer / admin — password login

`POST /api/v1/auth/officer/login` — no bearer. Same operation for both roles; `principal.role`
distinguishes them.

```json
{ "username": "officer", "password": "password" }
```

**200** same `AuthResponse` shape (`role`: `OFFICER` or `ADMIN`). **400**, **401**.

### 5.4 Current principal

`GET /api/v1/me` — bearer. **200** `Principal`. Use after restore-from-memory is not possible (refresh
always re-logins). **401**. Prefill farmer region from `divisionCode` / `districtCode` (and names);
do not collect region on submit.

### 5.5 Geography catalogue

`GET /api/v1/geo/divisions` — bearer, any role. **200** array of `{ code, nameEn, nameBn }` (8 rows).

`GET /api/v1/geo/divisions/{divisionCode}/districts` — bearer. **200** districts; **404** unknown
division. Codes such as `DHA` (Dhaka district) sit under division `DHK`. Do not send district on
`POST /api/v1/cases` — intake copies the farmer's identity.

---

## 6. Knowledge (any authenticated role)

Needed so farmers pick a crop and officers load disease/remedy/symptom catalogues. All **200** arrays
or objects; **401** / **404** as tagged in OpenAPI.

### `GET /api/v1/crops`

```json
[
  {
    "id": "01800000-0000-7000-8000-000000000001",
    "code": "rice",
    "nameBn": "ধান",
    "nameEn": "Rice",
    "nameEnFallback": false,
    "iconKey": "crop-rice"
  }
]
```

If `nameEnFallback` is `true`, show Bangla plus a visible `(bn)` marker (`WEB-UX-015`).

### `GET /api/v1/crops/{cropId}/diseases`

Array of `Disease` (`severity` ∈ `LOW` \| `MODERATE` \| `HIGH` \| `CRITICAL` \| `NONE`; `healthy`
boolean).

### `GET /api/v1/diseases/{diseaseId}`

Single `Disease`.

### `GET /api/v1/diseases/{diseaseId}/remedies`

Active remedies, server order. `type` ∈ `CULTURAL` \| `ORGANIC` \| `BIOLOGICAL` \| `CHEMICAL`.
`phiDays` is set when type is `CHEMICAL`. `stepsBn` is a string array — render as a numbered list in
**received order**.

### `GET /api/v1/symptoms`

Full taxonomy (`organ` ∈ `LEAF` \| `STEM` \| `ROOT` \| `PANICLE` \| `FRUIT` \| `TUBER` \| `WHOLE`).
Officer symptom picker uses these UUIDs.

---

## 7. Farmer APIs

**Intake limits (mirror in `app-config.ts`, prefer server if exposed later):** 1–3 images; JPEG/PNG/WebP;
max image 8 MiB; audio WAV/WebM/OGG/MP4, max 30 s / 4 MiB; client quality pre-filter is advisory —
the server gate is authoritative.

### 7.1 Submit a case

`POST /api/v1/cases` — role **FARMER**. Header **`Idempotency-Key`**: one UUID per attempt; **reuse
on retry of the same draft**; new key only when crop/images/audio/note change. Same key + different
body → **409**.

Multipart fields: `cropId` (required UUID), **`fieldArea`** (required number), **`fieldAreaUnit`**
(required ∈ `DECIMAL` \| `SQ_M` \| `SQ_FT` \| `HECTARE` \| `ACRE`), `images` (1–3 files), optional
`cropQuantity` / `cropQuantityUnit` (`KG` \| `TON` \| `PLANTS` \| `BIGHAS_EQUIV`), optional `noteBn`
(max 2000), optional `parentCaseId` (resubmit after reject), optional `audio`.

```http
POST /api/v1/cases
Authorization: Bearer <farmer-jwt>
Idempotency-Key: 3fa85f64-5717-4562-b3fc-2c963f66afa6
Content-Type: multipart/form-data

cropId = 01800000-0000-7000-8000-000000000001
fieldArea = 2
fieldAreaUnit = DECIMAL
cropQuantity = (optional)
cropQuantityUnit = (optional)
noteBn = (optional Bangla)
images = <file>   (repeat the part for each photo)
audio  = <file>   (optional)
```

**202** `CaseAccepted` (+ live `submittedAt`):

```json
{
  "caseId": "01a07caa-d991-7bae-9f48-5cc9a972cde8",
  "status": "SUBMITTED",
  "submittedAt": "2026-09-07T16:19:26.677409Z"
}
```

`Location: /api/v1/cases/{caseId}` may be present. Navigate to the status view (`WEB-FR-151`).

Also: **400**, **401**, **409**, **413**, **415**, **422** (quality — **nothing stored**), **429**,
**503** (storage / unexpected persist failure).

Analysis is **asynchronous**. Status moves `SUBMITTED` → `ANALYSING` → `ANALYSED` → `IN_REVIEW` (then
`ADVISED` or `REJECTED`). Drive the stepper from SSE, not a timer.

### 7.2 Case history

`GET /api/v1/cases?page=0&size=20` — **FARMER**, own cases only.

```json
{
  "page": 0,
  "size": 20,
  "totalElements": 1,
  "totalPages": 1,
  "content": [
    {
      "caseId": "01a07caa-d991-7bae-9f48-5cc9a972cde8",
      "cropNameBn": "ধান",
      "status": "IN_REVIEW",
      "decisionPath": "PRIMARY",
      "diseaseNameBn": null,
      "officerName": null,
      "advisoryVersion": null,
      "rejectionMessageBn": null,
      "thumbnailImageId": "018f…",
      "submittedAt": "2026-09-07T16:19:26.677409Z",
      "publishedAt": null
    }
  ]
}
```

`page` ≥ 0, `size` 1–100, default 20. Newest first is a **server** concern for this projection.

### 7.3 Case detail

`GET /api/v1/cases/{caseId}` — **200** `CaseDetail`:

```json
{
  "caseId": "01a07caa-d991-7bae-9f48-5cc9a972cde8",
  "cropId": "01800000-0000-7000-8000-000000000001",
  "cropNameBn": "ধান",
  "status": "ANALYSED",
  "decisionPath": "PRIMARY",
  "noteBn": null,
  "parentCaseId": null,
  "images": [
    {
      "imageId": "018f…",
      "position": 1,
      "primary": true,
      "qualityScore": 0.91,
      "width": 1600,
      "height": 1200
    }
  ],
  "audio": {
    "audioId": "018f…",
    "durationMs": 1200,
    "transcriptBn": null
  },
  "submittedAt": "2026-09-07T16:19:26.677409Z"
}
```

`audio` is `null` when unused. Another farmer’s case → **404** (never 403).

### 7.4 Image bytes

`GET /api/v1/cases/{caseId}/images/{imageId}/content?variant=DERIVATIVE`

`variant`: `ORIGINAL` \| `DERIVATIVE` (default `DERIVATIVE`). **302** to a time-limited MinIO URL.
Follow the redirect **without** the API JWT.

OpenAPI has **no** farmer audio-content URL. Do not invent one; if playback is required, raise a
blocker.

### 7.5 Analysis (farmer may read own case)

`GET /api/v1/cases/{caseId}/analysis` — **200** `AnalysisDetail`. Draw confidence bars using
**`thresholds.high` and `thresholds.low` from this payload** — never hard-code (`WEB-NFR-011`).
Configured demo values are `0.75` / `0.45` but the JSON is the source of truth.

```json
{
  "caseId": "01a07caa-d991-7bae-9f48-5cc9a972cde8",
  "decisionPath": "PRIMARY",
  "mode": "REPLAY",
  "top1Confidence": 0.88,
  "top2Confidence": 0.07,
  "margin": 0.81,
  "candidates": [
    {
      "diseaseId": "01800000-0000-7000-8000-000000000103",
      "diseaseCode": "blast",
      "diseaseNameBn": "Blast",
      "confidence": 0.88,
      "rank": 1,
      "source": "MODEL"
    }
  ],
  "symptoms": [],
  "transcriptBn": null,
  "asrConfidence": null,
  "hasGradcam": true,
  "unmappedLabels": [],
  "visionModelId": "replay",
  "visionModelVersion": null,
  "latencyMs": 12,
  "errorCode": null,
  "thresholds": { "high": 0.75, "low": 0.45 }
}
```

`decisionPath`: `PRIMARY` (high confidence) · `SECONDARY` (mid) · `UNDETERMINED` (low / sidecar
failure — still requires officer review). `mode`: `REPLAY` \| `LIVE`. Candidate `source`:
`MODEL` \| `KB` \| `MERGED`. Symptom `source`: `SPEECH` \| `VISION` \| `OFFICER`; `matcher`:
`VECTOR` \| `FUZZY` \| `MANUAL`.

**404** until analysis exists. After submit, wait for SSE `case-status` (or a manual refresh after a
gap).

### 7.6 Grad-CAM overlay

`GET /api/v1/cases/{caseId}/gradcam` — **302** presigned PNG, or **404** if none (`hasGradcam` false).

### 7.7 Advisory (the product)

`GET /api/v1/cases/{caseId}/advisory` — current published version. **200** `Advisory`; **404** if none
yet.

Show: disease name, officer name, **“verified by {officerName}”**, `publishedAt` in Dhaka, remedies
in order, `phiDays` as a labelled field, `version > 1` as revised.

`GET /api/v1/cases/{caseId}/advisories` — all versions, **newest first**. Use for prior-version
access (`WEB-FR-158`).

On rejection, history row carries `rejectionMessageBn`; there is no separate farmer “rejection
resource” beyond case status `REJECTED` and SSE.

Resubmit: `POST /api/v1/cases` with `parentCaseId` = rejected case id.

---

## 8. Officer APIs

Roles **OFFICER** and **ADMIN**. Queue order is **fixed by the server** (state, lowest confidence
first, then oldest). **Do not sort in the client** (`REVIEW-FR-030` / `WEB-FR-200`).

Claim **before** approve / reject / officer symptoms (`WEB-FR-240`). Claim TTL **15 minutes**
(`claimExpiresAt`). Optimistic lock: echo `task.version` as `expectedVersion` on writes when the
generated client requires it.

### 8.1 Queue

`GET /api/v1/review/queue?page=0&size=20`  
Optional `state`: `PENDING` \| `CLAIMED` \| `DONE` \| `REJECTED`.

**200** `PageOfOfficerQueueRow`:

```json
{
  "page": 0,
  "size": 20,
  "totalElements": 1,
  "totalPages": 1,
  "content": [
    {
      "caseId": "01a07caa-d991-7bae-9f48-5cc9a972cde8",
      "reviewTaskId": "018f…",
      "farmerName": "Demo Farmer",
      "cropCode": "rice",
      "cropNameBn": "ধান",
      "districtCode": "DHA",
      "decisionPath": "PRIMARY",
      "topDiseaseNameBn": "Blast",
      "topConfidence": 0.88,
      "imageCount": 1,
      "hasAudio": false,
      "analysisMode": "REPLAY",
      "state": "PENDING",
      "officerId": null,
      "isResubmission": false,
      "submittedAt": "2026-09-07T16:19:26.677409Z",
      "slaDueAt": "2026-09-07T20:19:26.677409Z"
    }
  ]
}
```

**403** if not officer/admin.

### 8.2 Task workspace (everything to decide)

`GET /api/v1/review/tasks/{taskId}` — **200** `ReviewCaseDetail`:

```json
{
  "task": {
    "taskId": "018f…",
    "caseId": "01a07caa-d991-7bae-9f48-5cc9a972cde8",
    "state": "PENDING",
    "officerId": null,
    "officerName": null,
    "claimedAt": null,
    "claimExpiresAt": null,
    "slaDueAt": "2026-09-07T20:19:26.677409Z",
    "requeueCount": 0,
    "version": 0
  },
  "case": { },
  "farmerName": "Demo Farmer",
  "analysis": { },
  "suggestedDiseaseId": "01800000-0000-7000-8000-000000000103",
  "suggestedRemedies": [ ],
  "priorAdvisory": null
}
```

`case` is `CaseDetail` (includes `fieldArea`, `fieldAreaUnit`, optional crop quantity, and
`metricsSource`); `analysis` is `AnalysisDetail` (thresholds for the wow-factor bars). Prefill
the editor from `suggestedDiseaseId` + `suggestedRemedies`; the officer may change them.
`suggestedRemedies` are for the **rank-1** disease only — analysis `candidates` remain on the payload
for context. When a remedy has human-owned rate columns and the case has field area, each suggested
remedy may include `computedDose` `{ amount, unit, basis, fromArea, fromAreaUnit }`; rates are often
null in demo seed data until content-owner C15. `priorAdvisory` is set on resubmissions.

Images: same **302** content URL as the farmer, using ids from `case.images`. Grad-CAM: `/gradcam`.

### 8.3 Claim / release

`POST /api/v1/review/tasks/{taskId}/claim` — empty body. **200** `ReviewTask`. **409** if another
officer holds it.

`POST /api/v1/review/tasks/{taskId}/release` — **200** `ReviewTask`. **409** if not the claimant.

### 8.4 Officer-observed symptoms

`POST /api/v1/review/tasks/{taskId}/symptoms`

```json
{ "symptomIds": ["01800000-0000-7000-8000-000000000301"] }
```

**204**. Stored with source `OFFICER`. **409** if not claimed by caller.

### 8.5 Approve / edit / replace (publish advisory)

`POST /api/v1/review/tasks/{taskId}/approve` — **201** `Advisory`, `Location` of the advisory.

OpenAPI body `PublishAdvisoryRequest`:

```json
{
  "action": "APPROVED",
  "diseaseId": "01800000-0000-7000-8000-000000000103",
  "remedyIds": ["01800000-0000-7000-8000-000000000507"],
  "officerNoteBn": "ডেমো অনুমোদন — মাঠ কর্মকর্তা থেকে",
  "expectedVersion": 1
}
```

`action` ∈ `APPROVED` \| `EDITED` \| `REPLACED`.

The live record matches OpenAPI (`action`, `diseaseId`, `remedyIds`, `officerNoteBn`,
`expectedVersion`). `./tools/call-api.sh` may omit `action`; the server still **derives**
`APPROVED` / `EDITED` / `REPLACED` from the submitted disease, remedies and note. Extra JSON
properties are ignored. Send `diseaseId` and `remedyIds` at minimum so the demo publishes.

**400**, **403**, **404**, **409**.

Returned `Advisory`:

```json
{
  "advisoryId": "018f…",
  "caseId": "01a07caa-d991-7bae-9f48-5cc9a972cde8",
  "diseaseId": "01800000-0000-7000-8000-000000000103",
  "diseaseNameBn": "Blast",
  "officerId": "01800000-0000-7000-8000-000000000202",
  "officerName": "Demo Officer",
  "action": "APPROVED",
  "officerNoteBn": "…",
  "version": 1,
  "supersedesId": null,
  "remedies": [ ],
  "publishedAt": "2026-09-07T16:25:00.000Z"
}
```

After success, return to the queue (`WEB-FR-234`). The farmer stream should receive an advisory event
within about a second.

### 8.6 Reject

`POST /api/v1/review/tasks/{taskId}/reject`

```json
{
  "reasonCode": "INSUFFICIENT_DETAIL",
  "messageBn": "আরও স্পষ্ট ছবি দিন",
  "expectedVersion": 1
}
```

`reasonCode` ∈ `BLURRY_IMAGE` \| `NOT_A_CROP` \| `WRONG_CROP` \| `INSUFFICIENT_DETAIL` \|
`INAUDIBLE_AUDIO` \| `OTHER`. **200** `Rejection`. Terminal; farmer resubmits with `parentCaseId`.

### 8.7 Revise a published advisory

`POST /api/v1/advisories/{advisoryId}/revise` — same body as approve. **201** new `Advisory` with
`version` incremented and `supersedesId` set. Farmer is notified again (`ADVISORY_REVISED`).

---

## 9. Admin APIs

Exactly one product screen: read-only stats (`WEB-FR-300`). CRUD is `[DEFERRED]`.

`GET /api/v1/admin/stats` — role **ADMIN** only. **200**:

```json
{
  "casesToday": 1,
  "approvalRate": 1.0,
  "medianReviewSeconds": 42,
  "modelOfficerAgreementRate": 1.0,
  "advisoriesPublished": 1,
  "casesRejected": 0,
  "pathCounts": { "PRIMARY": 1, "SECONDARY": 0, "UNDETERMINED": 0 },
  "thresholds": { "high": 0.75, "low": 0.45 }
}
```

**403** for farmer/officer. Admin may also use the officer console (same JWT, `role=ADMIN`).

---

## 10. SSE (`GET /api/v1/stream`)

Open **one** connection per session after login (`WEB-FR-351`).

```http
GET /api/v1/stream
Authorization: Bearer <jwt>
Accept: text/event-stream
Last-Event-ID: <optional>
```

Heartbeat: SSE **comment** every **20 s**. Idle timeout **30 minutes**, then event `reconnect` with
`{}` and close. On reconnect with `Last-Event-ID`, the server may emit `resync` with `{}` — **refetch
the visible view** (`WEB-FR-358`). Replay of missed frames is not guaranteed.

**Wire event names** (what `event:` actually contains today):

| `event:` | Who | `data` (JSON) |
|---|---|---|
| `case-status` | Farmer (own cases) | `notificationId`, `caseId`, `correlationId`, `fromStatus`, `toStatus` |
| `advisory` | Farmer | `notificationId`, `caseId`, `correlationId`, `advisoryId?`, `type` (`ADVISORY_PUBLISHED` \| `ADVISORY_REVISED` \| `CASE_REJECTED`), `titleBn`, `bodyBn` |
| `queue` | Officer / admin | `caseId`, `toStatus`, `correlationId` |
| `resync` | Reconnect | `{}` |
| `reconnect` | Before timeout close | `{}` |

Example:

```
event: advisory
id: 018f6666-0000-7000-8000-000000000001
data: {"notificationId":"018f…","caseId":"01a07caa-…","advisoryId":"018f…","type":"ADVISORY_PUBLISHED","titleBn":"…","bodyBn":"…","correlationId":"…"}
```

OpenAPI’s prose lists enum-style names (`CASE_STATUS_CHANGED`, …). **Bind to the `event:` column
above**, and read `data.type` on `advisory` frames. Ignore unknown event names without disconnecting
(`WEB-FR-352`).

On `case-status`: update the stepper from `toStatus` (values of `CaseStatus`).  
On `advisory` with `ADVISORY_PUBLISHED` / `ADVISORY_REVISED`: toast, then
`GET /api/v1/cases/{caseId}/advisory`.  
On `CASE_REJECTED`: toast, refresh case.  
On `queue`: **keep server order** — patch the matching row or refetch `GET /api/v1/review/queue`
for the current page; do not re-sort. Heartbeats are **comment** frames, not events. If the stream
is down, use the officer **manual refresh** (`WEB-FR-205`). **Do not poll on a timer** (`WEB-FR-356`,
`WEB-FR-359`).

`queue` frames are **not** stored in the `notification` table (`NOTIFY-FR-034`: that table is
farmer-addressed; `farmer_id` is `NOT NULL`). Absence of a row does not mean the officer stream is
broken — listen for `event: queue` on `GET /api/v1/stream`.

`GET /api/v1/notifications` exists in backend requirements but **not** in the frozen OpenAPI. Do not
call it from generated-client code until the spec includes it. Inbox for the demo is SSE + case
reads.

---

## 11. Status and enum cheat-sheet

**CaseStatus:** `SUBMITTED` → `ANALYSING` → `ANALYSED` → `IN_REVIEW` → `ADVISED` \| `REJECTED` \|
`FAILED`.

**Review task state:** `PENDING` \| `CLAIMED` \| `DONE` \| `REJECTED`.

**Roles:** `FARMER` \| `OFFICER` \| `ADMIN`.

---

## 12. Guided demo from the UI

Two browsers (or two profiles): farmer phone viewport and officer desktop.

The Angular capture path **re-encodes** every image (`WEB-FR-112`, GPS strip). Replay vision is
keyed by SHA-256 of the uploaded bytes, so a UI submit of `01-rice-blast-primary.jpg` will **not**
match the replay fixture (PRIMARY). Use the **live sidecar** for a UI PRIMARY/SECONDARY beat:

```bash
docker compose --profile ai up -d sidecar
FOSHOL_SPRING_PROFILES=local ./tools/start-stack.sh
```

(`local` still applies `db/seed`. Default `local,demo` is replay for byte-exact `call-api.sh` only.)
Without the sidecar, a UI case is `UNDETERMINED` and still reaches the officer queue (demo beat 8).

1. **Farmer login** — OTP request + verify. Open SSE. Load crops.
2. **Submit PRIMARY** — rice crop id, photo `01-rice-blast-primary.jpg`, new `Idempotency-Key`. Expect
   **202**, status view `SUBMITTED`.
3. Wait for farmer SSE `case-status` until `IN_REVIEW` (live analysis needs the sidecar; replay of
   **raw** demo files via the API client does not).
4. **Officer login** — queue shows the case, least-confident-first among whatever is pending. Open
   SSE and handle `event: queue` (then refetch the queue page).
5. Open task → **claim** → confirm analysis `decisionPath` and threshold lines match JSON → **approve**
   with suggested disease + at least one suggested remedy.
6. **Farmer** receives `advisory` SSE → load advisory card with officer name and verified stamp.
7. Optional: SECONDARY beat (photo + wav), blurry **422**, reject + resubmit with `parentCaseId`,
   revise advisory, admin stats page.

---

## 13. Frontend rules that affect API use

- No business rule that duplicates the backend (`WEB-NFR-001`).
- Never put token, phone, OTP or object keys in a URL (`WEB-SEC-002`).
- Never render server strings as HTML (`WEB-SEC-005`).
- Phone after login: last four digits only (`WEB-SEC-006`).
- Logout: clear stores, close SSE (`WEB-SEC-004`).
- Refresh = new login (no refresh token).

---

## 14. Endpoint index by actor

| Method | Path | Farmer | Officer | Admin | Demo-critical |
|---|---|---|---|---|---|
| POST | `/api/v1/auth/otp/request` | login | — | — | yes |
| POST | `/api/v1/auth/otp/verify` | login | — | — | yes |
| POST | `/api/v1/auth/officer/login` | — | login | login | yes |
| GET | `/api/v1/me` | yes | yes | yes | useful |
| GET | `/api/v1/geo/divisions` | yes | yes | yes | labels |
| GET | `/api/v1/geo/divisions/{code}/districts` | yes | yes | yes | labels |
| GET | `/api/v1/crops` | pick crop | yes | yes | yes |
| GET | `/api/v1/crops/{cropId}/diseases` | optional | editor | — | officer |
| GET | `/api/v1/diseases/{diseaseId}` | advisory context | editor | — | officer |
| GET | `/api/v1/diseases/{diseaseId}/remedies` | — | editor | — | officer |
| GET | `/api/v1/symptoms` | — | picker | — | optional |
| POST | `/api/v1/cases` | submit | — | — | yes |
| GET | `/api/v1/cases` | history | — | — | yes |
| GET | `/api/v1/cases/{caseId}` | status | via task | — | yes |
| GET | `/api/v1/cases/{caseId}/images/{imageId}/content` | thumbs | workspace | — | yes |
| GET | `/api/v1/cases/{caseId}/analysis` | optional | bars | — | officer |
| GET | `/api/v1/cases/{caseId}/gradcam` | optional | overlay | — | wow |
| GET | `/api/v1/cases/{caseId}/advisory` | card | — | — | yes |
| GET | `/api/v1/cases/{caseId}/advisories` | history | — | — | revise beat |
| GET | `/api/v1/review/queue` | — | yes | yes | yes |
| GET | `/api/v1/review/tasks/{taskId}` | — | yes | yes | yes |
| POST | `…/claim` `…/release` | — | yes | yes | yes |
| POST | `…/symptoms` | — | yes | yes | optional |
| POST | `…/approve` | — | yes | yes | yes |
| POST | `…/reject` | — | yes | yes | optional |
| POST | `/api/v1/advisories/{id}/revise` | — | yes | yes | optional |
| GET | `/api/v1/admin/stats` | — | — | yes | admin beat |
| GET | `/api/v1/stream` | yes | yes | yes | yes |

---

## 15. Known gaps (do not work around)

| Gap | Implication |
|---|---|
| `GET /api/v1/notifications` not in OpenAPI | No generated inbox; use SSE + case/advisory GETs |
| No OpenAPI audio content URL | Cannot play stored audio via a documented 302; raise a blocker if required |
| OpenAPI stream names vs wire `event:` | Use §10 wire names |

Contract owner: A1 / `docs/openapi/foshol-api.yaml`. UI lives in a separate Angular application.
