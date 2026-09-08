/**
 * WEB-NFR-009 — every threshold, limit, interval and size in the application is a named
 * constant in THIS FILE. No numeric literal may appear in a component or service.
 *
 * WEB-NFR-010 — where a constant mirrors a server property, the value the API supplies at
 * runtime WINS and the constant here is only a fallback. Each such entry names its server
 * property in a comment so the mirror is auditable.
 *
 * This file is frozen after Wave 0. A change to it is an amendment request, not an edit.
 */

export const APP_CONFIG = {
  /** The one API origin the Authorization header may ever be sent to (WEB-SEC-003). */
  api: {
    origin: 'http://localhost:8080',
    /** Not an OpenAPI operation, so it is reached by fetch rather than the client (WEB-FR-350). */
    streamPath: '/api/v1/stream',
  },

  /** Mirrors foshol.intake.* — the server gate remains authoritative (WEB-FR-125). */
  intake: {
    minImages: 1, //                     foshol.intake.min-images
    maxImages: 3, //                     foshol.intake.max-images
    maxImageBytes: 8_388_608, //         foshol.intake.max-image-bytes (8 MiB)
    allowedImageTypes: ['image/jpeg', 'image/png', 'image/webp'], // foshol.intake.allowed-image-types
    allowedAudioTypes: ['audio/wav', 'audio/webm', 'audio/ogg', 'audio/mp4'], // foshol.intake.allowed-audio-types
    maxAudioSeconds: 30, //              foshol.intake.max-audio-seconds
    maxAudioBytes: 4_194_304, //         foshol.intake.max-audio-bytes (4 MiB)
    noteMaxLength: 2000, //              OpenAPI: submitCase.noteBn maxLength
    quality: {
      minEdgePx: 224, //                 foshol.intake.quality.min-edge-px
      blurVarianceMin: 60.0, //          foshol.intake.quality.blur-variance-min
    },
  },

  /**
   * Mirrors foshol.analysis.confidence.*. FALLBACK ONLY — WEB-NFR-011 requires the officer
   * console to read both thresholds from `AnalysisDetail.thresholds` on every case. A
   * hard-coded line that disagrees with the routing is worse than no line at all.
   */
  analysis: {
    confidenceHighFallback: 0.75, //     foshol.analysis.confidence.high
    confidenceLowFallback: 0.45, //      foshol.analysis.confidence.low
  },

  auth: {
    otpLength: 6, //                     foshol.auth.otp.length
    otpTtlMs: 300_000, //                foshol.auth.otp.ttl (PT5M)
    /** The wire speaks seconds (`expiresInSeconds`, `Retry-After`); keep both, convert nowhere else. */
    otpTtlSeconds: 300,
    jwtTtlMs: 28_800_000, //             foshol.auth.jwt.ttl (PT8H)
    /** WEB-SEC-006 — a phone number is shown only as its last four digits after login. */
    phoneVisibleDigits: 4,
    phonePattern: /^\+8801[3-9]\d{8}$/,
  },

  review: {
    claimTtlMs: 900_000, //              foshol.review.claim.ttl (PT15M)
    /** Claim countdown presentation. Amber, then clay, each also changing text + glyph. */
    claimWarnMs: 180_000,
    claimCriticalMs: 60_000,
    claimTickMs: 1_000,
  },

  i18n: {
    defaultLocale: 'bn' as const, //     foshol.i18n.default-locale
    supportedLocales: ['bn', 'en'] as const, // foshol.i18n.supported-locales
    displayZone: 'Asia/Dhaka', //        foshol.i18n.display-zone (WEB-DATA-006)
    cataloguePath: '/i18n/',
  },

  storage: {
    presignTtlMs: 600_000, //            foshol.storage.presign-ttl (PT10M)
    /** Re-presign this far ahead of expiry so an <img> never loads a dead URL. */
    presignRefreshMarginMs: 30_000,
  },

  /** WEB-DATA-020 — the ONLY two localStorage keys this application owns. */
  storageKeys: {
    lang: 'foshol.lang',
    draft: 'foshol.draft',
  },

  /** Client capture pipeline. No server property defines these. */
  capture: {
    maxEdgePx: 1600, //                  re-encode target; must exceed quality.minEdgePx
    jpegQuality: 0.82, //                chosen to stay under intake.maxImageBytes
    qualityLadder: [0.82, 0.7, 0.6, 0.5], // WEB-FR-114 stepwise reduction
    fallbackEdgePx: 1200, //             last resort before rejecting for size
    analysisEdgePx: 224, //              short edge of the quality-gate canvas
    /**
     * WEB-FR-124 [DERIVED]. A hue/saturation coverage heuristic is the honest client-side
     * approximation of "is this a crop photograph" — there is no client-side model. Because
     * the heuristic is weak it NEVER permanently blocks a farmer: it always offers an
     * override. Blur and size rejections get no override, because the server would reject
     * those anyway.
     */
    vegetationCoverageMin: 0.12,
    vegHueMinDeg: 60, //                 yellow-green (chlorosis) …
    vegHueMaxDeg: 170, //                … through cyan-green
    vegSatMin: 0.18,
    vegValMin: 0.12, //                  excludes shadow
    vegValMax: 0.98, //                  excludes blown highlight
    /**
     * The client's Laplacian variance cannot equal the server's exactly (different
     * resampling filter). Tuned toward PERMISSIVE in the E2E pass against the two known
     * demo JPEGs: never reject locally what the server would accept.
     */
    blurVarianceClientMargin: 1.0,
  },

  audio: {
    sampleRateHz: 16_000, //             ASR input rate (Whisper consumes 16 kHz mono)
    channels: 1, //                      mono
    targetPeakDbfs: -3.0, //             WEB-FR-134 loudness normalisation target
    /** Cap the normalisation gain so a silent clip is not amplified into hiss. */
    maxGain: 8,
    /** Safari has refused OfflineAudioContext below 22.05 kHz; render high, then decimate. */
    offlineFallbackRateHz: 48_000,
    decimationFactor: 3,
    fftSize: 2048, //                    AnalyserNode, for the live waveform
    /** The waveform draws to canvas at rAF; only the seconds counter writes a signal. */
    meterIntervalMs: 100,
  },

  /** WEB-FR-355 reconnect backoff. WEB-FR-356 forbids any polling timer. */
  sse: {
    initialRetryMs: 1_000,
    maxRetryMs: 30_000,
    backoffMultiplier: 2,
    jitterRatio: 0.2,
    heartbeatMs: 20_000, //              foshol.channels.sse.heartbeat (PT20S)
    timeoutMs: 1_800_000, //             foshol.channels.sse.timeout (PT30M)
    /**
     * 2.5x the heartbeat. A TCP connection dead behind a proxy never errors; the heartbeat
     * comments are precisely what makes that detectable. This is a watchdog on an open
     * stream, not a poll of an endpoint.
     */
    staleAfterMs: 50_000,
  },

  page: {
    defaultSize: 20, //                  00-common §8.2 default
    maxSize: 100, //                     00-common §8.2 max
  },

  ui: {
    spinnerDelayMs: 300, //              delay before a loading indicator appears
    toastMs: 6_000,
    /** Rounding used for every confidence and threshold position, so 0.45 → "45%" exactly. */
    percentPrecision: 4,
    minTouchTargetPx: 44, //             WEB-UX-033
    recordTargetPx: 64, //               WEB-UX-021
    /** One second, for any visible countdown. Not a poll — nothing here touches the network. */
    tickMs: 1_000,
    msPerSecond: 1_000,
    secondsPerMinute: 60,
  },
} as const;

export type AppConfig = typeof APP_CONFIG;
export type Locale = (typeof APP_CONFIG.i18n.supportedLocales)[number];
