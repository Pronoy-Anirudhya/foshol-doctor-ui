# `core/media/out-of-contract` — the one hand-written URL in the application

**Deviation D-02.** Everything in this directory departs from `WEB-API-001` and `WEB-NFR-006`.
It is one directory, one service, and it is fenced off here so the seam stays visible
(`00-common` §1.2) instead of quietly becoming a habit.

## What departs

`media-url.service.ts` calls two operations that exist in the running backend but are **not** in
the frozen `docs/openapi/foshol-api.yaml`, and so are absent from `src/app/generated/`:

| Operation | Why the frontend needs it |
|---|---|
| `GET /api/v1/cases/{caseId}/images/{imageId}/url?variant=derivative\|original` | returns the presigned URL as JSON |
| `GET /api/v1/cases/{caseId}/audio/url` | ditto, for the case audio (`WEB-FR-213`) |

Because they are not generated, their paths are written by hand — the only two hand-written
request paths in the application.

## Why, rather than using the documented operation

The documented `GET …/images/{imageId}/content` answers **302** with a `Location` pointing at a
presigned MinIO URL on a **different origin** (`http://127.0.0.1:9000` in the demo), and the API
itself requires a bearer token. An `<img src>` cannot carry a bearer token, so the documented
operation cannot feed an `<img>` directly.

The alternatives were weighed as follows.

- **Fetch `…/content` with the header and follow the redirect into a blob.** Compliance with
  `WEB-SEC-003` would then rest on per-browser redirect header-stripping behaviour, every
  thumbnail would sit in memory as a blob with no HTTP caching, and each one would need its
  object URL revoked. Rejected for the general image path.
- **Use `…/url` and bind the returned URL to `<img [src]>`.** The image then loads as a plain
  no-CORS subresource: MinIO needs no CORS configuration at all, HTTP caching works, and the JWT
  provably never leaves the API origin because the only request that carries it is the JSON call
  to `/url`. Chosen.

That the second option is also the *safer* one is the point. Sending the bearer to the presigned
URL is not merely forbidden, it does not work: MinIO answers a presigned GET that also carries an
`Authorization` header with **400 `InvalidRequest` — "request has multiple authentication types"**.
`WEB-SEC-003` is load-bearing, not decorative.

## The `variant` trap

The two endpoints disagree, and they disagree in *both* directions. From
`modules/intake/.../web/CaseController.java`:

```java
// …/content
@RequestParam(defaultValue = "DERIVATIVE") String variant
boolean derivative = !"ORIGINAL".equalsIgnoreCase(variant);   // default: DERIVATIVE

// …/url
@RequestParam(defaultValue = "original") String variant
boolean derivative = "derivative".equalsIgnoreCase(variant);  // default: ORIGINAL
```

`/content` defaults to the derivative and treats anything that is not `ORIGINAL` as a derivative.
`/url` defaults to the **original** and only the word `derivative` selects the derivative. So a
caller that omits `variant`, or that ports a working `/content` call across, silently gets the
full-size original for every thumbnail in the queue.

`media-url.service.ts` therefore **always sends `variant` explicitly** and never relies on a
default. `derivative` for thumbnails and the queue, `original` for the zoom view.

One further note, confirmed against the live server: `CaseImageUrlQueryHandler` falls back to the
original object key when a derivative was never stored, so today both variants can presign the
same object. That is the server's business; the client still states which it wants.

## Unblock

1. Add the two operations, and a `PresignedUrlView` schema (`{ url, expiresAt }`), to
   `docs/openapi/foshol-api.yaml`. Owner: agent A1 — the file is frozen (`00-common` §12.1).
2. `pnpm run api:gen`.
3. **Delete this directory** and point `SecureMediaService` at the generated `CasesService`.

Nothing else in the application may add a file here. Every other call goes through
`src/app/generated/`, which `pnpm run check:arch` enforces by refusing `HttpClient` injection
outside `core/http`, `core/media`, `core/sse` and `core/i18n`.
