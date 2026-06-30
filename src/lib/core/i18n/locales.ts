export const SUPPORTED_LOCALES = ['es', 'en'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

export const LOCALE_COOKIE = 'fewya-locale';

export function isLocale(value: string | null | undefined): value is Locale {
    return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function parseAcceptLanguage(header: string | null | null): Locale | null {
    if (!header) return null;
    const tags = header.split(',');
    let best: { locale: Locale; quality: number } | null = null;
    for (const tag of tags) {
        const [rawCode, ...params] = tag.trim().split(';');
        const code = rawCode.split('-')[0].toLowerCase();
        if (!isLocale(code)) continue;
        const qParam = params.find(p => p.trim().startsWith('q='));
        const quality = qParam ? parseFloat(qParam.split('=')[1]) : 1;
        if (!Number.isFinite(quality)) continue;
        if (!best || quality > best.quality) {
            best = { locale: code, quality };
        }
    }
    return best?.locale ?? null;
}

interface LocaleContext {
    cookies: { get: (name: string) => { value?: string } | undefined };
    request: { headers: { get: (name: string) => string | null } };
}

export function resolveLocale({ cookies, request }: LocaleContext): Locale {
    const cookieValue = cookies.get(LOCALE_COOKIE)?.value;
    if (isLocale(cookieValue)) return cookieValue;
    const fromHeader = parseAcceptLanguage(request.headers.get('Accept-Language'));
    if (fromHeader) return fromHeader;
    return DEFAULT_LOCALE;
}

export const LOCALE_LABELS: Record<Locale, string> = {
    es: 'Español',
    en: 'English',
};
