import { spainProvinces } from '../shipping/spain-provinces';

export interface ValidationError {
    field: string;
    message: string;
}

export interface ProfileFormData {
    first_name: string;
    last_name: string;
    phone: string;
    phone_prefix: string;
    address_street: string;
    address_number: string;
    address_floor: string;
    address_postal_code: string;
    address_city: string;
    address_province: string;
    address_country: string;
}

const POSTAL_CODE_RANGES: Record<string, { min: number; max: number }> = {
    ES: { min: 1000, max: 52999 },
};

const phoneRegexMap: Record<string, RegExp> = {
    '+34': /^6\d{8}$|^7\d{8}$|^9\d{8}$/,
    '+376': /^3\d{6}$/,
    '+349': /^8\d{8}$/,
    '+351': /^9\d{8}$/,
    '+33': /^6\d{8}$|^7\d{8}$/,
};

function getPhoneRegex(prefix: string): RegExp | null {
    return phoneRegexMap[prefix] || null;
}

export function validateProfileForm(data: ProfileFormData): ValidationError[] {
    const errors: ValidationError[] = [];
    const { first_name, last_name, phone, phone_prefix, address_street, address_number, address_floor, address_postal_code, address_city, address_province, address_country } = data;

    if (!first_name.trim()) {
        errors.push({ field: 'first_name', message: 'validationRequired' });
    } else {
        if (first_name.trim().length < 2) {
            errors.push({ field: 'first_name', message: 'validationNameMinLength' });
        }
        if (first_name.trim().length > 50) {
            errors.push({ field: 'first_name', message: 'validationNameMaxLength' });
        }
        if (!/^[a-zA-ZáéíóúÁÉÍÓÚñÑüÜ\s'-]+$/.test(first_name.trim())) {
            errors.push({ field: 'first_name', message: 'validationNameFormat' });
        }
    }

    if (!last_name.trim()) {
        errors.push({ field: 'last_name', message: 'validationRequired' });
    } else {
        if (last_name.trim().length < 2) {
            errors.push({ field: 'last_name', message: 'validationLastNameMinLength' });
        }
        if (last_name.trim().length > 100) {
            errors.push({ field: 'last_name', message: 'validationLastNameMaxLength' });
        }
        if (!/^[a-zA-ZáéíóúÁÉÍÓÚñÑüÜ\s'-]+$/.test(last_name.trim())) {
            errors.push({ field: 'last_name', message: 'validationNameFormat' });
        }
    }

    if (!phone_prefix) {
        errors.push({ field: 'phone_prefix', message: 'validationPhonePrefixMissing' });
    }

    if (phone.trim()) {
        const phoneDigits = phone.replace(/\s/g, '');
        const phoneRegex = getPhoneRegex(phone_prefix);
        if (phoneRegex && !phoneRegex.test(phoneDigits)) {
            errors.push({ field: 'phone', message: 'validationPhoneFormat' });
        }
    }

    if (!address_street.trim()) {
        errors.push({ field: 'address_street', message: 'validationRequired' });
    } else {
        if (address_street.trim().length < 3) {
            errors.push({ field: 'address_street', message: 'validationStreetMinLength' });
        }
        if (address_street.trim().length > 100) {
            errors.push({ field: 'address_street', message: 'validationStreetMaxLength' });
        }
    }

    if (address_number.trim().length > 20) {
        errors.push({ field: 'address_number', message: 'validationNumberMaxLength' });
    }

    if (address_floor.trim().length > 30) {
        errors.push({ field: 'address_floor', message: 'validationFloorMaxLength' });
    }

    if (!address_postal_code.trim()) {
        errors.push({ field: 'address_postal_code', message: 'validationRequired' });
    } else {
        if (!/^\d{5}$/.test(address_postal_code.trim())) {
            errors.push({ field: 'address_postal_code', message: 'validationPostalCodeFormat' });
        } else if (address_country === 'ES') {
            const num = parseInt(address_postal_code, 10);
            const { min, max } = POSTAL_CODE_RANGES['ES'];
            if (num < min || num > max) {
                errors.push({ field: 'address_postal_code', message: 'validationPostalCodeFormatEs' });
            }
        }
    }

    if (!address_city.trim()) {
        errors.push({ field: 'address_city', message: 'validationRequired' });
    } else {
        if (address_city.trim().length < 2) {
            errors.push({ field: 'address_city', message: 'validationCityMinLength' });
        }
        if (address_city.trim().length > 100) {
            errors.push({ field: 'address_city', message: 'validationCityMaxLength' });
        }
        if (!/^[a-zA-ZáéíóúÁÉÍÓÚñÑüÜ\s'-]+$/.test(address_city.trim())) {
            errors.push({ field: 'address_city', message: 'validationCityFormat' });
        }
    }

    if (address_country === 'ES') {
        const validProvinces = spainProvinces.map(p => p.name);
        if (!address_province || !validProvinces.includes(address_province)) {
            errors.push({ field: 'address_province', message: 'validationProvinceRequiredEs' });
        }
    }

    return errors;
}

export function getFieldError(errors: ValidationError[], field: string): string | null {
    const error = errors.find(e => e.field === field);
    return error ? error.message : null;
}