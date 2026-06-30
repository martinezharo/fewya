import { describe, it, expect } from 'vitest';
import {
    DEFAULT_LOCALE,
    LOCALE_LABELS,
    SUPPORTED_LOCALES,
    getCategories,
    getCategoryLabel,
    getT,
    isLocale,
    parseAcceptLanguage,
    resolveLocale,
} from '../../src/lib/core/i18n';
import { en } from '../../src/lib/core/i18n/strings.en';
import { es } from '../../src/lib/core/i18n/strings.es';

describe('i18n.locales', () => {
    it('soporta únicamente es y en', () => {
        expect(SUPPORTED_LOCALES).toEqual(['es', 'en']);
    });

    it('English es el idioma por defecto (fallback cuando el navegador no encaja)', () => {
        expect(DEFAULT_LOCALE).toBe('en');
    });

    it('isLocale reconoce ambos códigos y rechaza el resto', () => {
        expect(isLocale('es')).toBe(true);
        expect(isLocale('en')).toBe(true);
        expect(isLocale('fr')).toBe(false);
        expect(isLocale(null)).toBe(false);
        expect(isLocale(undefined)).toBe(false);
        expect(isLocale('es-ES')).toBe(false);
    });
});

describe('i18n.parseAcceptLanguage', () => {
    it('devuelve el primer locale soportado en orden de calidad', () => {
        expect(parseAcceptLanguage('fr-FR,fr;q=0.9,es;q=0.8,en;q=0.7')).toBe('es');
        expect(parseAcceptLanguage('en-US,en;q=0.9')).toBe('en');
    });

    it('prefiere el q más alto cuando hay varios matches', () => {
        expect(parseAcceptLanguage('es;q=0.5,en;q=0.9')).toBe('en');
    });

    it('devuelve null cuando no hay un locale soportado', () => {
        expect(parseAcceptLanguage('fr-FR,de;q=0.9')).toBeNull();
        expect(parseAcceptLanguage(null)).toBeNull();
        expect(parseAcceptLanguage('')).toBeNull();
    });
});

describe('i18n.resolveLocale', () => {
    const request = (header: string | null) => ({
        headers: { get: (name: string) => (name === 'Accept-Language' ? header : null) },
    });
    const noCookies = { get: () => undefined };

    it('la cookie fewya-locale gana sobre Accept-Language', () => {
        const cookies = { get: (n: string) => (n === 'fewya-locale' ? { value: 'es' } : undefined) };
        expect(resolveLocale({ cookies, request: request('en-US') })).toBe('es');
    });

    it('si la cookie es inválida, usa Accept-Language', () => {
        const cookies = { get: (n: string) => (n === 'fewya-locale' ? { value: 'fr' } : undefined) };
        expect(resolveLocale({ cookies, request: request('en-US,en;q=0.9') })).toBe('en');
    });

    it('si la cookie es inválida y el header tampoco encaja, cae al default', () => {
        const cookies = { get: (n: string) => (n === 'fewya-locale' ? { value: 'fr-FR' } : undefined) };
        expect(resolveLocale({ cookies, request: request('ja-JP,ko;q=0.9') })).toBe('en');
    });

    it('si no hay cookie ni header, devuelve el default', () => {
        expect(resolveLocale({ cookies: noCookies, request: request(null) })).toBe('en');
    });
});

describe('i18n.getT', () => {
    it('devuelve los strings en el idioma solicitado', () => {
        expect(getT('es').siteTitle).toBe(es.siteTitle);
        expect(getT('en').siteTitle).toBe(en.siteTitle);
    });

    it('un locale desconocido cae al default (en)', () => {
        // @ts-expect-error: bypassing the public type to test the fallback
        expect(getT('xx').siteTitle).toBe(en.siteTitle);
    });

    it('todos los locales exportados tienen las mismas keys (sin keys huérfanas)', () => {
        const enKeys = Object.keys(en).sort();
        const esKeys = Object.keys(es).sort();
        expect(esKeys).toEqual(enKeys);
    });
});

describe('i18n.categories', () => {
    it('getCategories devuelve 11 categorías en orden estable', () => {
        expect(getCategories(es)).toHaveLength(11);
        expect(getCategories(es)[0].value).toBe('ropa');
        expect(getCategories(en)[0].value).toBe('ropa');
    });

    it('las etiquetas cambian con el idioma', () => {
        expect(getCategoryLabel(es, 'tecnologia')).toBe('Tecnología');
        expect(getCategoryLabel(en, 'tecnologia')).toBe('Tech');
    });

    it('getCategoryLabel devuelve el valor tal cual si la categoría no existe', () => {
        expect(getCategoryLabel(es, 'inexistente')).toBe('inexistente');
        expect(getCategoryLabel(es, null)).toBe('');
        expect(getCategoryLabel(es, undefined)).toBe('');
    });
});

describe('i18n.LOCALE_LABELS', () => {
    it('cada locale tiene una etiqueta legible', () => {
        for (const code of SUPPORTED_LOCALES) {
            expect(LOCALE_LABELS[code].length).toBeGreaterThan(0);
        }
    });
});
