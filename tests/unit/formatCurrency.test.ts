import { describe, it, expect } from 'vitest';
import { formatCurrency } from '../../src/lib/core/formatCurrency';

describe('formatCurrency', () => {
    it('es: coma decimal y símbolo € detrás del importe', () => {
        expect(formatCurrency(12.5, 'es')).toMatch(/^12,50\s€$/);
        expect(formatCurrency(0, 'es')).toMatch(/^0,00\s€$/);
        expect(formatCurrency(1234.5, 'es')).toContain('1234,50');
    });

    it('en: punto decimal y símbolo € delante del importe', () => {
        expect(formatCurrency(12.5, 'en')).toBe('€12.50');
        expect(formatCurrency(0, 'en')).toBe('€0.00');
        expect(formatCurrency(1234.5, 'en')).toContain('1,234.50');
    });

    it('siempre redondea/rellena a 2 decimales', () => {
        expect(formatCurrency(3, 'es')).toMatch(/^3,00\s€$/);
        expect(formatCurrency(3, 'en')).toBe('€3.00');
        expect(formatCurrency(3.999, 'en')).toBe('€4.00');
    });

    it('maneja importes negativos de forma consistente con Intl', () => {
        expect(formatCurrency(-5, 'en')).toBe('-€5.00');
        expect(formatCurrency(-5, 'es')).toMatch(/^-5,00\s€$/);
    });

    it('cae al formateo inglés para un locale desconocido', () => {
        // @ts-expect-error: bypassing the public type to test the fallback
        expect(formatCurrency(12.5, 'xx')).toBe('€12.50');
    });

    it('nunca hardcodea la posición del símbolo: es y en difieren', () => {
        const esOut = formatCurrency(9.9, 'es');
        const enOut = formatCurrency(9.9, 'en');
        expect(esOut.endsWith('€')).toBe(true);
        expect(enOut.startsWith('€')).toBe(true);
        expect(esOut).not.toBe(enOut);
    });
});
