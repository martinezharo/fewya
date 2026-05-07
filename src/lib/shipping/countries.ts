import { countries, getEmojiFlag } from 'countries-list';

export interface CountryOption {
    code: string;
    name: string;
    phonePrefix: string;
    flag: string;
}

export function getAllCountries(): CountryOption[] {
    const list: CountryOption[] = Object.entries(countries).map(([code, data]) => {
        const phone = Array.isArray(data.phone) ? data.phone[0] : data.phone;
        return {
            code,
            name: data.name,
            phonePrefix: `+${phone}`,
            flag: getEmojiFlag(code as any) || '🏳️',
        };
    });

    return list.sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

export function getCountryByCode(code: string): CountryOption | undefined {
    const all = getAllCountries();
    return all.find((c) => c.code === code.toUpperCase());
}

export function getPhonePrefixes(): CountryOption[] {
    return getAllCountries();
}
