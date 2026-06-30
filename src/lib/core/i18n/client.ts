import { es } from './strings.es';
import type { Strings } from './types';
import { DEFAULT_LOCALE, type Locale } from './locales';

declare global {
    interface Window {
        __fewyaLocale__?: Locale;
        __fewyaT__?: Strings;
    }
}

/**
 * Client-side accessor for the active strings. Resolves to the strings object
 * that the server-rendered Layout injected on the page, falling back to the
 * default locale if the global hasn't been set yet (e.g. early in page load
 * or during a unit test).
 */
export function getClientT(): Strings {
    if (typeof window !== 'undefined' && window.__fewyaT__) {
        return window.__fewyaT__;
    }
    return es;
}

export function getClientLocale(): Locale {
    if (typeof window !== 'undefined' && window.__fewyaLocale__) {
        return window.__fewyaLocale__;
    }
    return DEFAULT_LOCALE;
}
