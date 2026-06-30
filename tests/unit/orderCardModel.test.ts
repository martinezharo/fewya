import { describe, it, expect } from 'vitest';
import {
    normalizeOrderStatus,
    getStatusBadgeClass,
    getStatusLabel,
    formatEur,
    formatOrderDate,
    getSellerDeliveryFlags,
    getRefundedAmounts,
    formatShippingCell,
} from '../../src/lib/orders/orderCardModel';
import { FUND_HOLD_MS } from '../../src/lib/orders/timing';
import { es } from '../../src/lib/core/i18n/strings.es';

describe('normalizeOrderStatus', () => {
    it('lowercases y permite estados válidos', () => {
        expect(normalizeOrderStatus('PAID')).toBe('paid');
        expect(normalizeOrderStatus('delivered')).toBe('delivered');
    });

    it('fallback a pending para valores nulos o desconocidos', () => {
        expect(normalizeOrderStatus(null)).toBe('pending');
        expect(normalizeOrderStatus(undefined)).toBe('pending');
        expect(normalizeOrderStatus('weird')).toBe('pending');
    });
});

describe('getStatusBadgeClass / getStatusLabel', () => {
    it('cada status mapea a una clase no vacía y a una etiqueta', () => {
        const statuses = ['pending', 'paid', 'processing', 'shipped', 'delivered', 'confirmed', 'incident', 'cancelled', 'refunded'] as const;
        for (const s of statuses) {
            expect(getStatusBadgeClass(s)).toBeTruthy();
            expect(getStatusLabel(es, s)).toBeTruthy();
        }
    });
});

describe('formatEur', () => {
    it('formatea con símbolo EUR y locale es-ES', () => {
        const out = formatEur(12.5);
        expect(out).toContain('12,50');
        expect(out).toMatch(/€/);
    });
});

describe('formatOrderDate', () => {
    it('formatea fechas en es-ES con día, mes corto y año', () => {
        const d = new Date('2025-03-15T10:00:00Z');
        const out = formatOrderDate(d);
        expect(out).toMatch(/2025/);
    });
});

describe('getSellerDeliveryFlags', () => {
    it('aún no puede confirmar antes de 48h', () => {
        const delivered = new Date();
        const flags = getSellerDeliveryFlags('delivered', delivered, delivered.getTime() + 1000);
        expect(flags.canSellerConfirm).toBe(false);
        expect(flags.isRecentlyDelivered).toBe(true);
    });

    it('puede confirmar exactamente al pasar 48h', () => {
        const delivered = new Date();
        const flags = getSellerDeliveryFlags('delivered', delivered, delivered.getTime() + FUND_HOLD_MS);
        expect(flags.canSellerConfirm).toBe(true);
        expect(flags.isRecentlyDelivered).toBe(false);
    });

    it('no confirma si el status no es delivered', () => {
        const flags = getSellerDeliveryFlags('paid', new Date(0), Date.now());
        expect(flags.canSellerConfirm).toBe(false);
        expect(flags.isRecentlyDelivered).toBe(false);
    });

    it('no confirma si falta deliveredAt', () => {
        const flags = getSellerDeliveryFlags('delivered', null, Date.now());
        expect(flags.canSellerConfirm).toBe(false);
    });
});

describe('getRefundedAmounts', () => {
    it('no muestra refunded si el status no es refunded', () => {
        const r = getRefundedAmounts('paid', 10, 2);
        expect(r.showRefunded).toBe(false);
    });

    it('formatea importes solo si el reembolso es > 0', () => {
        const r = getRefundedAmounts('refunded', 25.5, 3);
        expect(r.showRefunded).toBe(true);
        expect(r.refundedAmountFormatted).toContain('25,50');
        expect(r.shippingRetainedFormatted).toContain('3,00');
    });

    it('omite shippingRetained cuando es 0 o null', () => {
        const r = getRefundedAmounts('refunded', 10, null);
        expect(r.shippingRetainedFormatted).toBe('');
    });
});

describe('formatShippingCell', () => {
    it('devuelve "Gratis" cuando es 0', () => {
        expect(formatShippingCell(es, 0)).toBe(es.freeLabel);
    });

    it('formatea importes cuando es > 0', () => {
        expect(formatShippingCell(es, 3.5)).toContain('3,50');
    });
});
