# File ownership

The conflict-avoidance contract for a build carried out by many agents in parallel. An agent
writes **only** inside its globs. A change needed anywhere else is an amendment request to the
integrator, applied between waves — never an edit inside one.

## Frozen after Wave 0

Changing any of these affects every agent, so they are integrator-only:

```
package.json  package-lock.json  angular.json  tsconfig*.json  .postcssrc.json
src/styles.css            the design tokens
src/app/app.config.ts     bootstrap providers
src/app/app.routes.ts     the role-routed shell
src/app/core/config/app-config.ts    every constant (WEB-NFR-009)
scripts/**                the five build gates
src/app/generated/**      regenerated, never hand-edited (COMMON-NFR-043)
public/i18n/*.json        build output of scripts/merge-i18n.mjs — edit a fragment instead
openapi/foshol-api.yaml   output of scripts/sync-openapi.mjs
```

## Wave assignments

| Agent | Globs | Requirements |
|---|---|---|
| **A-http** | `core/http/**`, `core/errors/**` | `WEB-FR-005/006/013/401`, `WEB-SEC-002/003`, `WEB-API-002`, `WEB-TEST-006` |
| **A-auth** | `core/auth/{auth.guard,role.guard,auth-facade}.ts`, `features/auth/**` | `WEB-FR-001/002/003/010`–`013`, `WEB-SEC-001/004/006` |
| **A-kit** | `shared/ui/{app-shell,app-header,lang-toggle,sse-indicator,toast-host,live-region,offline-banner,error-panel,spinner,skeleton,empty-state,paginator,copy-button,page-heading,pictogram,bn-value}/**`, `shared/pipes/**`, `shared/directives/**`, `app.ts/html/css`, `index.html` | `WEB-FR-357/400/402`, `WEB-UX-012/015/041/042/046`, `WEB-API-003`, `WEB-DATA-006`, `WEB-SEC-006` |
| **B-primitives** | `shared/ui/{confidence-bar,decision-path-badge,analysis-mode-badge,severity-badge,matcher-chip,candidate-source-chip,status-stepper}/**` | `WEB-FR-152/214/215/216/220`–`224`, `WEB-NFR-011`, **`WEB-TEST-001`** |
| **B-sse-stores** | `core/sse/**`, `core/stores/**`, `testing/harness/**` | `WEB-FR-200/204/350`–`359`, `WEB-DATA-002/004/005`, **`WEB-TEST-004/005`** |
| **B-media** | `core/media/**`, `shared/ui/{secure-image,image-zoom,audio-player,gradcam-view}/**` | `WEB-FR-154/210`–`213`, `WEB-SEC-003` |
| **C-capture** | `features/farmer/{crop-picker,capture}/**`, `testing/factories/**` | `WEB-FR-100/101/110`–`146/150`, **`WEB-TEST-002/008`** |
| **C-farmer-view** | `features/farmer/{status,history,advisory}/**`, `farmer.routes.ts` | `WEB-FR-151`–`160` |
| **C-officer** | `features/officer/**` | `WEB-FR-200`–`244` |
| **C-admin** | `features/admin/**` | `WEB-FR-300`–`305` |

## Strings

Each agent owns exactly one fragment, `src/i18n/<namespace>.i18n.json`, and the filename fixes
the key prefix it may use. Nobody edits `public/i18n/*.json` by hand.

## Two things that are deliberately not owned by a feature

- **`core/media/out-of-contract/`** — the only hand-written URLs in the application, quarantined
  behind a banner and `DEVIATIONS.md` D-02.
- **`testing/fixtures/`** — captured from the live server by the integrator; agronomic prose is
  replaced with placeholders so that editing a fixture is never editing agronomy.
