# Foshol Doctor UI — the brief every agent works to

Read this in full before writing a line. It is the contract that lets many agents build one
coherent application in parallel.

## The product, in one sentence

AI-triaged crop-disease diagnosis from photographs and Bangla speech, where **every single case
is approved by a human field officer before any advice reaches the farmer**. The human approval
workflow *is* the product; the AI is a triage accelerator. The UI exists to make the
two-threshold routing and the human gate **visible**.

## Sources of truth — read the ones that apply to you

| Document | What it is |
|---|---|
| `/Users/a.sarker/Work/Code/foshol-doctor/docs/requirements/70-frontend.ears.md` | The 164 `WEB-*` requirements. Your work traces to IDs from here. |
| `/Users/a.sarker/Work/Code/foshol-doctor/docs/handover/frontend-demo-api.md` | Wire-level API guide: demo credentials, stable UUIDs, **the §10 SSE wire event names**. |
| `/Users/a.sarker/Work/Code/foshol-doctor/docs/openapi/foshol-api.yaml` | The FROZEN contract. Never edited. Already generated into `src/app/generated/`. |
| `src/app/core/config/app-config.ts` | Every constant. Frozen. |

**No requirement, no code.** If what you need is not specified, do not invent it — record a
blocker in `DEVIATIONS.md` and implement the nearest specified behaviour.

## Absolute rules — breaking one breaks the build

1. **Zero new runtime dependencies** (`WEB-NFR-007`). Angular 22.1.5, Tailwind 4, ngx-translate
   and nothing else. No icon pack, no motion library, no chart library, no date library, no JWT
   library, no state library. A needed library is a blocker, not a choice. Dev-only tooling is
   also off-limits without asking.
2. **Signals only** (`WEB-NFR-002`). No NgRx, no `BehaviorSubject` acting as state, no
   long-lived manual subscription outside the SSE client. RxJS appears only where an Angular
   API forces it, and converts to a signal at the store boundary (`WEB-NFR-003`). The generated
   API services already return **Promises**, so feature code sees no Observables at all.
3. **Never author agricultural content** (`COMMON-CON-003`). Disease names, symptom text,
   remedy steps, dosages and pre-harvest intervals are human-supplied and render **exactly as
   the server returns them**. Never translate a content field. Never invent a plausible-looking
   dosage — a wrong dosage is not a bug, it is harm. UI chrome you *do* author (labels,
   buttons, errors) is fine.
4. **No user-visible string literal** in a template or component class (`WEB-UX-013`). Every
   string is a translation key. See "Adding strings" below.
5. **No numeric literal** in a component or service (`WEB-NFR-009`). Everything comes from
   `APP_CONFIG`. Tailwind class names and CSS values are not affected by this rule.
6. **Never render a server string as HTML** (`WEB-SEC-005`). No `innerHTML`, no
   `bypassSecurityTrustHtml`. Interpolate as text.
7. **Never construct an API URL by string concatenation** (`WEB-API-001`). Call the generated
   services. The only exceptions are the SSE stream and the two out-of-contract media
   endpoints, both already built for you in `core/`.
8. **Never re-implement a backend rule** (`WEB-NFR-001`). Decision path, severity, queue order,
   claim state and confidence thresholds are rendered as received, never recomputed.
9. **Only touch files inside your assigned globs.** If you need a change elsewhere, STOP and
   report it as an amendment request in your final message. Do not edit it yourself.
10. **No barrel files.** No `index.ts` anywhere. Deep imports only.

## Environment

- Project root: `/Users/a.sarker/Work/Code/foshol-doctor-ui`
- This directory is **outside the Bash sandbox**, so every command that writes to it must pass
  `dangerouslyDisableSandbox: true`. Reads are fine either way.
- The backend is already running at `http://localhost:8080` (profiles `local,demo`). Use
  `node -e "fetch(...)"` to probe it — `curl` is blocked by the permission gate.
- Demo credentials: farmer `+8801711111111` / OTP `123456`; officer `officer` / `password`;
  admin `admin` / `password`.

## How to verify your work

```bash
cd /Users/a.sarker/Work/Code/foshol-doctor-ui && npm run verify
```

That runs: i18n parity, exact-pin check, the architecture lint, the WCAG contrast gate, and
`tsc` under `strict` + `strictTemplates`. **Your work is not done until this passes.** Then run
your own tests with `npx ng test --no-watch`.

## Adding strings (this is how many agents share the catalogues)

Create or edit **only your own fragment**, `src/i18n/<your-namespace>.i18n.json`. Every key
carries **both** languages:

```json
{
  "officer.queue.orderNote": {
    "bn": "সবচেয়ে কম আত্মবিশ্বাসের কেস আগে",
    "en": "Least-confident cases first"
  }
}
```

The fragment filename determines the required key prefix: `officer-queue.i18n.json` owns
`officer.queue.*`. `npm run i18n:build` merges all fragments into `public/i18n/{bn,en}.json`.
Because both languages sit in one entry, `WEB-UX-017` (identical key sets) cannot be violated.

Write real Bangla. If you are unsure of a UI phrase, keep it short and plain — but never invent
agronomic wording (rule 3).

## Code style

- **Standalone components**, `ChangeDetectionStrategy.OnPush`, `signal` / `computed` / `input()`
  / `output()`. Never `@Input()`/`@Output()` decorators, never constructor injection — use
  `inject()`.
- Reads: `resource({ params, loader })` calling a generated service. Its `.reload()` **is** the
  manual-refresh control; there is never a polling timer (`WEB-FR-356`).
- Writes: `await` a generated service method inside a store or facade method, then set signals.
- Templates use the built-in control flow: `@if`, `@for` (always with `track`), `@switch`.
- Every component template imports `TranslatePipe` from `@ngx-translate/core` for strings.
- Comment the **why**, never the what. Cite the requirement ID when a line exists because of a
  requirement. Do not narrate obvious code.
- British spelling in prose and comments.

## Accessibility floor — not optional (`WEB-UX-040`…`046`)

- Every control keyboard-reachable in a logical tab order, with a visible focus indicator (the
  global `:focus-visible` rule already handles this — do not remove outlines).
- **Colour is never the sole carrier of meaning.** Every severity indicator carries a text
  label AND a glyph; every badge carries its text value; every confidence bar carries its
  numeric value and labelled threshold lines.
- Meaningful `alt` on every image, including pictograms and the Grad-CAM overlay.
- Interactive targets ≥ 44×44 px on touch (`touch-target` utility); the recorder ≥ 64×64
  (`touch-target-lg`).
- Async status changes announce through an ARIA live region.

## Responsive (`WEB-UX-030`…`034`)

Mobile-first. Verified at **360 px, 768 px, 1280 px**. No horizontal page scroll at 360 px on
any route — wide content scrolls inside its own `overflow-x-auto` container. Use only Tailwind
breakpoints; never write a media query in a component stylesheet.

## The design system — "Field Light"

Tokens live in `src/styles.css` and are available as Tailwind utilities:
`bg-surface-0/1/2/3`, `text-ink`, `text-ink-muted`, `text-ink-faint`, `text-ink-invert`,
`bg-paddy-600` (primary), `bg-dawn-600` (warning), `bg-clay-600` (destructive),
`bg-slate-800` (officer console chrome), `outline-focus`, plus `shadow-card` / `shadow-lift` /
`shadow-stamp`, `ease-settle`, `duration-1/2/3`, and the `card`, `touch-target`,
`touch-target-lg`, `font-latin`, `sr-only-focusable` utilities.

Warm, agricultural, confident. Generous whitespace, large type, rounded corners (`rounded-2xl`
on cards), soft shadows. Motion **settles, never bounces**. The palette is contrast-gated by
`npm run check:contrast` — if you need a new colour, it must pass, so add the pair to that
script's list.

This is for a hackathon: aim for genuine visual delight, but never at the cost of a
requirement, a contrast ratio, or a colour-only meaning.
