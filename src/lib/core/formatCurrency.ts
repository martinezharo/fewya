import type { Locale } from './i18n/locales';

/**
 * Currency is always EUR (see AGENTS.md), but the *display* conventions
 * (symbol before/after the amount, comma vs. period decimal separator)
 * differ by locale. This maps our supported app locales to a full BCP 47
 * tag purely so `Intl.NumberFormat` picks the right display conventions —
 * it does not imply the amount is ever charged in anything but EUR.
 */
const INTL_LOCALE_BY_LOCALE: Record<Locale, string> = {
    es: 'es-ES',
    en: 'en-IE',
};

const formatterCache = new Map<Locale, Intl.NumberFormat>();

function getFormatter(locale: Locale): Intl.NumberFormat {
    let formatter = formatterCache.get(locale);
    if (!formatter) {
        formatter = new Intl.NumberFormat(INTL_LOCALE_BY_LOCALE[locale] ?? INTL_LOCALE_BY_LOCALE.en, {
            style: 'currency',
            currency: 'EUR',
        });
        formatterCache.set(locale, formatter);
    }
    return formatter;
}

/**
 * Formats an EUR amount using the active locale's display conventions.
 * Use this instead of ad hoc `toFixed(2)` + string concatenation, which
 * tends to hardcode Spanish conventions (comma decimals, trailing " €")
 * that are wrong for the English locale.
 */
export function formatCurrency(amount: number, locale: Locale): string {
    return getFormatter(locale).format(amount);
}
