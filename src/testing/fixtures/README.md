# API fixtures (`WEB-TEST-007`)

One JSON file per response shape. Most were **captured from the running backend** rather than
hand-written, so they match what the server actually sends — including the places where it
diverges from the frozen contract (see `../../../LIVE-API-NOTES.md`).

Every agronomic string has been replaced with an obvious `[fieldName]` placeholder.
`COMMON-CON-003` makes disease, symptom and remedy prose human-supplied content; copying it into
test fixtures would blur that line, and an agent editing a fixture must never be editing
agronomy. Structure, ids, enums, numbers and nullability are all real.

| Fixture | Source | Notes |
|---|---|---|
| `queue-page.json` | live | `PageOfOfficerQueueRow` |
| `case-detail-primary.json` | live | `CaseDetail` |
| `analysis-primary.json` | live | `AnalysisDetail`, `PRIMARY`, real `thresholds` |
| `analysis-secondary.json` | authored | `SECONDARY` with speech symptoms, a transcript and unmapped labels |
| `analysis-undetermined.json` | authored | `UNDETERMINED` carrying `errorCode` — the demo beat 8 sidecar failure |
| `review-task-live-shape.json` | live | **the flat shape**, not the contract's nested one |
| `advisory-v1.json` | live | published advisory |
| `advisory-v2-revised.json` | authored | `version: 2`, `supersedesId` set, includes a `CHEMICAL` remedy with `phiDays` |
| `rejection.json` | authored | terminal rejection |
| `case-history-page.json` | authored | one row per terminal state |
| `crops.json`, `diseases-rice.json`, `remedies-blast.json`, `symptoms.json` | live | knowledge catalogues |
| `admin-stats-live-shape.json` | live | the flat, differently-named stats body |
| `problem.json`, `quality-gate-problem.json` | authored | RFC 9457 bodies |
| `principal-*.json` | live | the three actors |

Binary image and audio fixtures are **generated inside the test** (`WEB-TEST-008`), never
committed — see `../factories/`.
