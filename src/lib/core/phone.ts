const COUNTRY_TO_PREFIX: Record<string, string> = {
    ES: '+34',
    AD: '+376',
    PT: '+351',
    FR: '+33',
};

export const DEFAULT_PHONE_PREFIX = '+34';

export function defaultPhonePrefixForCountry(country: string | null | undefined): string {
    if (!country) return DEFAULT_PHONE_PREFIX;
    return COUNTRY_TO_PREFIX[country.toUpperCase()] ?? DEFAULT_PHONE_PREFIX;
}

export function resolvePhonePrefix(
    profile: { phone_prefix?: string | null; address_country?: string | null } | null | undefined
): string {
    const explicit = profile?.phone_prefix?.trim();
    if (explicit) return explicit;
    return defaultPhonePrefixForCountry(profile?.address_country ?? null);
}
