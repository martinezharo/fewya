import { describe, it, expect } from 'vitest';
import { buildNotification } from '../../src/lib/notifications/templates';
import { NOTIFICATION_TYPE, type NotificationType } from '../../src/lib/notifications/types';

const ALL_TYPES = Object.values(NOTIFICATION_TYPE) as NotificationType[];

describe('buildNotification', () => {
    it('produce contenido completo para cada tipo de notificación', () => {
        for (const type of ALL_TYPES) {
            const built = buildNotification(type, {
                orderPublicId: 'ORD-123',
                shopName: 'Tienda Demo',
                trackingUrl: 'https://track.example/abc',
                pickupPointName: 'Punto Centro',
            });
            expect(built.emailSubject.length).toBeGreaterThan(0);
            expect(built.emailHtml).toContain('<!DOCTYPE html>');
            expect(built.pushTitle.length).toBeGreaterThan(0);
            expect(built.pushBody.length).toBeGreaterThan(0);
            expect(built.url.length).toBeGreaterThan(0);
            // No deben quedar placeholders sin interpolar.
            expect(built.emailSubject).not.toContain('{');
            expect(built.pushBody).not.toContain('{');
        }
    });

    it('interpola el número de pedido y la tienda', () => {
        const built = buildNotification(NOTIFICATION_TYPE.SELLER_NEW_SALE, {
            orderPublicId: 'ORD-777',
        });
        expect(built.emailSubject).toContain('ORD-777');
        expect(built.pushBody).toContain('ORD-777');
    });

    it('usa la URL de seguimiento como destino cuando está disponible (ready to send)', () => {
        const built = buildNotification(NOTIFICATION_TYPE.BUYER_READY_TO_SEND, {
            orderPublicId: 'ORD-1',
            trackingUrl: 'https://track.example/xyz',
        });
        expect(built.url).toBe('https://track.example/xyz');
    });

    it('cae a la página del pedido del comprador cuando no hay tracking', () => {
        const built = buildNotification(NOTIFICATION_TYPE.BUYER_READY_TO_SEND, {
            orderPublicId: 'ORD-1',
            trackingUrl: null,
        });
        expect(built.url).toContain('/me/orders');
        expect(built.url).toContain('ORD-1');
    });

    it('los recordatorios de vendedor enlazan a la gestión del pedido', () => {
        for (const type of [NOTIFICATION_TYPE.SELLER_LABEL_REMINDER, NOTIFICATION_TYPE.SELLER_SHIP_REMINDER]) {
            const built = buildNotification(type, { orderPublicId: 'ORD-9' });
            expect(built.url).toContain('/sell/orders');
        }
    });

    it('menciona la cancelación en 5 días laborables en los recordatorios de vendedor', () => {
        const label = buildNotification(NOTIFICATION_TYPE.SELLER_LABEL_REMINDER, { orderPublicId: 'ORD-2' });
        const ship = buildNotification(NOTIFICATION_TYPE.SELLER_SHIP_REMINDER, { orderPublicId: 'ORD-2' });
        expect(label.emailHtml).toContain('5 días laborables');
        expect(ship.emailHtml).toContain('5 días laborables');
    });

    it('escapa HTML en los datos interpolados (anti-inyección)', () => {
        const built = buildNotification(NOTIFICATION_TYPE.SELLER_NEW_SALE, {
            orderPublicId: '<script>alert(1)</script>',
        });
        expect(built.emailHtml).not.toContain('<script>alert(1)</script>');
        expect(built.emailHtml).toContain('&lt;script&gt;');
    });
});
