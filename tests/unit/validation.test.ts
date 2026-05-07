import { describe, it, expect } from 'vitest';
import { validateProfileForm, getFieldError, type ProfileFormData } from '../../src/lib/core/validation';

function createProfile(overrides: Partial<ProfileFormData> = {}): ProfileFormData {
    return {
        first_name: 'Juan',
        last_name: 'García',
        phone: '612345678',
        phone_prefix: '+34',
        address_street: 'Calle Mayor',
        address_number: '5',
        address_floor: '2B',
        address_postal_code: '28001',
        address_city: 'Madrid',
        address_province: 'Madrid',
        address_country: 'ES',
        ...overrides,
    };
}

describe('validateProfileForm', () => {
    it('pasa con datos completos válidos', () => {
        const errors = validateProfileForm(createProfile());
        expect(errors).toHaveLength(0);
    });

    describe('nombre', () => {
        it('requiere first_name', () => {
            const errors = validateProfileForm(createProfile({ first_name: '' }));
            expect(errors.some(e => e.field === 'first_name')).toBe(true);
        });

        it('rechaza nombre corto', () => {
            const errors = validateProfileForm(createProfile({ first_name: 'A' }));
            expect(errors.some(e => e.message === 'validationNameMinLength')).toBe(true);
        });

        it('rechaza nombre demasiado largo', () => {
            const errors = validateProfileForm(createProfile({ first_name: 'A'.repeat(51) }));
            expect(errors.some(e => e.message === 'validationNameMaxLength')).toBe(true);
        });

        it('rechaza caracteres inválidos en nombre', () => {
            const errors = validateProfileForm(createProfile({ first_name: 'Juan123' }));
            expect(errors.some(e => e.message === 'validationNameFormat')).toBe(true);
        });
    });

    describe('apellido', () => {
        it('requiere last_name', () => {
            const errors = validateProfileForm(createProfile({ last_name: '' }));
            expect(errors.some(e => e.field === 'last_name')).toBe(true);
        });

        it('rechaza apellido corto', () => {
            const errors = validateProfileForm(createProfile({ last_name: 'B' }));
            expect(errors.some(e => e.message === 'validationLastNameMinLength')).toBe(true);
        });
    });

    describe('teléfono', () => {
        it('requiere prefijo telefónico', () => {
            const errors = validateProfileForm(createProfile({ phone_prefix: '' }));
            expect(errors.some(e => e.field === 'phone_prefix')).toBe(true);
        });

        it('valida formato español (+34)', () => {
            const errors = validateProfileForm(createProfile({ phone: '612345678' }));
            expect(errors.some(e => e.field === 'phone')).toBe(false);
        });

        it('rechaza teléfono español inválido', () => {
            const errors = validateProfileForm(createProfile({ phone: '123456789' }));
            expect(errors.some(e => e.field === 'phone')).toBe(true);
        });
    });

    describe('dirección', () => {
        it('requiere calle', () => {
            const errors = validateProfileForm(createProfile({ address_street: '' }));
            expect(errors.some(e => e.field === 'address_street')).toBe(true);
        });

        it('rechaza calle corta', () => {
            const errors = validateProfileForm(createProfile({ address_street: 'AB' }));
            expect(errors.some(e => e.message === 'validationStreetMinLength')).toBe(true);
        });

        it('rechaza número demasiado largo', () => {
            const errors = validateProfileForm(createProfile({ address_number: 'A'.repeat(21) }));
            expect(errors.some(e => e.field === 'address_number')).toBe(true);
        });
    });

    describe('código postal', () => {
        it('requiere CP', () => {
            const errors = validateProfileForm(createProfile({ address_postal_code: '' }));
            expect(errors.some(e => e.field === 'address_postal_code')).toBe(true);
        });

        it('rechaza CP con letras', () => {
            const errors = validateProfileForm(createProfile({ address_postal_code: '28A01' }));
            expect(errors.some(e => e.message === 'validationPostalCodeFormat')).toBe(true);
        });

        it('rechaza CP español fuera de rango', () => {
            const errors = validateProfileForm(createProfile({ address_postal_code: '00000' }));
            expect(errors.some(e => e.message === 'validationPostalCodeFormatEs')).toBe(true);
        });

        it('acepta CP español válido', () => {
            const errors = validateProfileForm(createProfile({ address_postal_code: '01001' }));
            expect(errors.some(e => e.field === 'address_postal_code')).toBe(false);
        });
    });

    describe('ciudad', () => {
        it('requiere ciudad', () => {
            const errors = validateProfileForm(createProfile({ address_city: '' }));
            expect(errors.some(e => e.field === 'address_city')).toBe(true);
        });

        it('rechaza ciudad con números', () => {
            const errors = validateProfileForm(createProfile({ address_city: 'Madrid2' }));
            expect(errors.some(e => e.message === 'validationCityFormat')).toBe(true);
        });
    });

    describe('provincia', () => {
        it('requiere provincia válida para España', () => {
            const errors = validateProfileForm(createProfile({ address_province: '' }));
            expect(errors.some(e => e.field === 'address_province')).toBe(true);
        });

        it('rechaza provincia inválida para España', () => {
            const errors = validateProfileForm(createProfile({ address_province: 'FakeProvince' }));
            expect(errors.some(e => e.message === 'validationProvinceRequiredEs')).toBe(true);
        });
    });
});

describe('getFieldError', () => {
    it('devuelve el mensaje de error para un campo', () => {
        const errors = [{ field: 'first_name', message: 'validationRequired' }];
        expect(getFieldError(errors, 'first_name')).toBe('validationRequired');
    });

    it('devuelve null si no hay error para el campo', () => {
        expect(getFieldError([], 'first_name')).toBeNull();
    });
});
