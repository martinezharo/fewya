import { es } from './strings.es';
import { en } from './strings.en';
import type { Strings } from './types';
import { DEFAULT_LOCALE, type Locale } from './locales';

const STRINGS_BY_LOCALE: Record<Locale, Strings> = { es, en };

export function getT(locale: Locale = DEFAULT_LOCALE): Strings {
    return STRINGS_BY_LOCALE[locale] ?? STRINGS_BY_LOCALE[DEFAULT_LOCALE];
}

export type { Strings } from './types';
export {
    DEFAULT_LOCALE,
    LOCALE_COOKIE,
    LOCALE_LABELS,
    SUPPORTED_LOCALES,
    isLocale,
    parseAcceptLanguage,
    resolveLocale,
} from './locales';
export type { Locale } from './locales';
export { es } from './strings.es';
export { en } from './strings.en';
export { getCategories, getCategoryLabel } from './categories';
export type { CategoryOption, CategoryValue } from './categories';
export { getClientT, getClientLocale } from './client';
