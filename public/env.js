/*
 * Runtime deployment configuration, read by src/app/core/config/runtime-config.ts.
 *
 * This copy is the DEVELOPMENT one and is deliberately empty: with no apiBaseUrl the app falls
 * back to APP_CONFIG.api.origin (http://localhost:8080), which is what `ng serve` has always
 * talked to and what the backend's CORS allow-list already permits.
 *
 * The container image overwrites this file. Do not put a real URL here.
 */
window.__FOSHOL_RUNTIME__ = {};
