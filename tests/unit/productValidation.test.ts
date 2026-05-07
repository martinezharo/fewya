import { describe, it, expect } from 'vitest';
import {
    validateProductCompleteness,
    formatShippingDisplay,
    isProductComplete,
    validateCheckoutReadiness,
} from '../../src/lib/productValidation';

describe('validateProductCompleteness', () => {
    it('devuelve completo para producto válido con variantes', () => {
        const product = {
            title: 'Camiseta',
            description: 'Algodón orgánico',
            category: 'ropa',
            slug: 'camiseta',
            gallery_images: ['img1.jpg'],
        };
        const variants = [
            {
                price: 19.99,
                stock: 10,
                weight_kg: 0.3,
                length_cm: 30,
                width_cm: 20,
                height_cm: 2,
                shipping_cost: 3.5,
            },
        ];

        const result = validateProductCompleteness(product, variants);
        expect(result.complete).toBe(true);
        expect(result.missing).toHaveLength(0);
    });

    it('detecta producto sin título', () => {
        const result = validateProductCompleteness(
            { description: 'Desc', category: 'ropa', slug: 'x', gallery_images: ['img'] },
            [{ price: 10, stock: 1, weight_kg: 1, length_cm: 1, width_cm: 1, height_cm: 1, shipping_cost: 0 }]
        );
        expect(result.complete).toBe(false);
        expect(result.missing).toContain('nombre');
    });

    it('detecta producto sin imágenes', () => {
        const result = validateProductCompleteness(
            { title: 'X', description: 'Desc', category: 'ropa', slug: 'x', gallery_images: [] },
            [{ price: 10, stock: 1, weight_kg: 1, length_cm: 1, width_cm: 1, height_cm: 1, shipping_cost: 0 }]
        );
        expect(result.missing).toContain('fotos');
    });

    it('detecta variantes vacías', () => {
        const result = validateProductCompleteness(
            { title: 'X', description: 'Desc', category: 'ropa', slug: 'x', gallery_images: ['img'] },
            []
        );
        expect(result.missing).toContain('variantes');
    });

    it('detecta variante sin precio válido', () => {
        const result = validateProductCompleteness(
            { title: 'X', description: 'Desc', category: 'ropa', slug: 'x', gallery_images: ['img'] },
            [{ price: 0, stock: 5, weight_kg: 1, length_cm: 1, width_cm: 1, height_cm: 1, shipping_cost: 0 }]
        );
        expect(result.missing).toContain('variante con precio, stock y datos de envío completos');
    });

    it('detecta variante con stock negativo', () => {
        const result = validateProductCompleteness(
            { title: 'X', description: 'Desc', category: 'ropa', slug: 'x', gallery_images: ['img'] },
            [{ price: 10, stock: -1, weight_kg: 1, length_cm: 1, width_cm: 1, height_cm: 1, shipping_cost: 0 }]
        );
        expect(result.missing).toContain('variante con precio, stock y datos de envío completos');
    });

    it('detecta variante con dimensiones faltantes', () => {
        const result = validateProductCompleteness(
            { title: 'X', description: 'Desc', category: 'ropa', slug: 'x', gallery_images: ['img'] },
            [{ price: 10, stock: 5, weight_kg: 0, length_cm: 1, width_cm: 1, height_cm: 1, shipping_cost: 0 }]
        );
        expect(result.missing).toContain('variante con precio, stock y datos de envío completos');
    });
});

describe('formatShippingDisplay', () => {
    it('devuelve cadena vacía para coste nulo', () => {
        expect(formatShippingDisplay(null)).toBe('');
        expect(formatShippingDisplay(undefined)).toBe('');
    });

    it('muestra envío gratis para coste 0', () => {
        expect(formatShippingDisplay(0)).toBe('Envío gratis');
    });

    it('formatea coste con coma decimal', () => {
        expect(formatShippingDisplay(3.5)).toBe('+3,50€ envío');
        expect(formatShippingDisplay(10)).toBe('+10,00€ envío');
    });
});

describe('isProductComplete', () => {
    it('devuelve true para producto completo', () => {
        const product = {
            title: 'X',
            description: 'Desc',
            category: 'ropa',
            slug: 'x',
            gallery_images: ['img'],
            variants: [{ price: 10, stock: 1, weight_kg: 1, length_cm: 1, width_cm: 1, height_cm: 1, shipping_cost: 0 }],
        };
        expect(isProductComplete(product)).toBe(true);
    });
});

describe('validateCheckoutReadiness', () => {
    it('permite checkout de producto activo con stock suficiente', () => {
        const product = { is_active: true, title: 'X' };
        const variant = { price: 10, stock: 5, shipping_cost: 3 };
        const result = validateCheckoutReadiness(product, variant, 2);
        expect(result.ready).toBe(true);
    });

    it('rechaza producto inactivo', () => {
        const result = validateCheckoutReadiness(
            { is_active: false, title: 'X' },
            { price: 10, stock: 5, shipping_cost: 3 },
            1
        );
        expect(result.ready).toBe(false);
        expect(result.reason).toBe('product_inactive');
    });

    it('rechaza producto sin título', () => {
        const result = validateCheckoutReadiness(
            { is_active: true, title: '' },
            { price: 10, stock: 5, shipping_cost: 3 },
            1
        );
        expect(result.reason).toBe('product_incomplete');
    });

    it('rechaza precio inválido (0 o negativo)', () => {
        const result = validateCheckoutReadiness(
            { is_active: true, title: 'X' },
            { price: 0, stock: 5, shipping_cost: 3 },
            1
        );
        expect(result.reason).toBe('invalid_price');
    });

    it('rechaza stock insuficiente', () => {
        const result = validateCheckoutReadiness(
            { is_active: true, title: 'X' },
            { price: 10, stock: 2, shipping_cost: 3 },
            3
        );
        expect(result.reason).toBe('out_of_stock');
    });

    it('rechaza envío faltante (negativo)', () => {
        const result = validateCheckoutReadiness(
            { is_active: true, title: 'X' },
            { price: 10, stock: 5, shipping_cost: -1 },
            1
        );
        expect(result.reason).toBe('missing_shipping');
    });
});
