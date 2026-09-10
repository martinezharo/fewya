import type { FunctionReturnType } from 'convex/server';
import type { api } from '../../../convex/_generated/api';

/** The profile document Convex returns for the authenticated caller. */
export type CurrentProfile = NonNullable<FunctionReturnType<typeof api.users.current>>;

/**
 * The profile shape the UI and the checkout validators speak.
 *
 * Convex stores camelCase fields; pages, forms and `isProfileComplete` were
 * written against the original snake_case columns and keep using them. One
 * mapper in one place is what keeps those two vocabularies from drifting.
 */
export interface ProfileFields {
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    avatar_url: string | null;
    phone: string | null;
    phone_prefix: string | null;
    address_street: string | null;
    address_number: string | null;
    address_floor: string | null;
    address_postal_code: string | null;
    address_city: string | null;
    address_province: string | null;
    address_country: string | null;
    email_marketing_opt_in: boolean;
    is_seller: boolean;
}

export function toProfileFields(profile: CurrentProfile | null | undefined): ProfileFields | null {
    if (!profile) return null;
    return {
        first_name: profile.firstName ?? null,
        last_name: profile.lastName ?? null,
        email: profile.email ?? null,
        avatar_url: profile.avatarUrl ?? null,
        phone: profile.phone ?? null,
        phone_prefix: profile.phonePrefix ?? null,
        address_street: profile.addressStreet ?? null,
        address_number: profile.addressNumber ?? null,
        address_floor: profile.addressFloor ?? null,
        address_postal_code: profile.addressPostalCode ?? null,
        address_city: profile.addressCity ?? null,
        address_province: profile.addressProvince ?? null,
        address_country: profile.addressCountry ?? null,
        email_marketing_opt_in: profile.emailMarketingOptIn ?? false,
        is_seller: profile.isSeller ?? false,
    };
}
