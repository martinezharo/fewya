import { describe, it, expect } from 'vitest';
import { calculateParcelFromItems, parseSpanishAddress } from '../../src/lib/shipping/sendcloud';

describe('calculateParcelFromItems', () => {
    it('consolida varias unidades del mismo item en un único parcel apilado', () => {
        const items = [
            { weightKg: 1, lengthCm: 20, widthCm: 15, heightCm: 10, quantity: 2 },
        ];
        const parcels = calculateParcelFromItems(items);
        expect(parcels).toHaveLength(1);
        expect(parcels[0]).toEqual({ weight: 2, length: 20, width: 15, height: 20 });
    });

    it('usa valores por defecto cuando faltan dimensiones', () => {
        const items = [{ quantity: 1 }];
        const parcels = calculateParcelFromItems(items);
        expect(parcels).toHaveLength(1);
        expect(parcels[0]).toEqual({ weight: 0.5, length: 10, width: 10, height: 10 });
    });

    it('consolida múltiples items en un único paquete', () => {
        const items = [
            { weightKg: 1, lengthCm: 10, widthCm: 10, heightCm: 10, quantity: 1 },
            { weightKg: 2, lengthCm: 20, widthCm: 20, heightCm: 20, quantity: 2 },
        ];
        const parcels = calculateParcelFromItems(items);
        expect(parcels).toHaveLength(1);
        // peso = 1 + 2*2 = 5; largo/ancho = max(10,20) = 20; alto = 10 + 20*2 = 50
        expect(parcels[0]).toEqual({ weight: 5, length: 20, width: 20, height: 50 });
    });

    it('devuelve array vacío si no hay items con cantidad', () => {
        expect(calculateParcelFromItems([])).toEqual([]);
        expect(calculateParcelFromItems([{ quantity: 0 }])).toEqual([]);
    });
});

describe('parseSpanishAddress', () => {
    it('extrae CP, calle y ciudad de dirección española típica', () => {
        const result = parseSpanishAddress('Calle Mayor 5, 28001, Madrid');
        expect(result.postalCode).toBe('28001');
        expect(result.city).toBe('Madrid');
        expect(result.street).toContain('Calle Mayor 5');
    });

    it('maneja dirección multilinea', () => {
        const result = parseSpanishAddress('Calle Gran Vía 12\n28013, Madrid');
        expect(result.postalCode).toBe('28013');
        expect(result.city).toBe('Madrid');
    });

    it('devuelve CP vacío si no encuentra código postal', () => {
        const result = parseSpanishAddress('Calle Falsa, Madrid');
        expect(result.postalCode).toBe('');
    });

    it('documenta comportamiento cuando CP y ciudad no están separados por coma', () => {
        const result = parseSpanishAddress('Calle Mayor 5, 28001 Madrid');
        expect(result.postalCode).toBe('28001');
        // La ciudad incluye el CP porque la función toma la última parte después de split(',')
        expect(result.city).toBe('28001 Madrid');
    });
});
