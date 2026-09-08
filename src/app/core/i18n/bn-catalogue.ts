import bn from '../../../../public/i18n/bn.json';

/**
 * The Bangla catalogue, inlined at build time.
 *
 * Bangla is the language of record (COMMON-NFR-037), so it must never be a fetch that can
 * fail. Bundling it guarantees the WEB-UX-014 fallback always has something to fall back TO,
 * and gives a zero-latency first paint in the default locale. Only `en` is loaded lazily.
 */
export const BN_CATALOGUE: Readonly<Record<string, string>> = bn;
