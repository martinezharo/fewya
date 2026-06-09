import { buildPushPayload } from '@block65/webcrypto-web-push';
import { getVapidConfig } from '../core/env';
import type { StoredPushSubscription } from './types';

export interface PushPayload {
    title: string;
    body: string;
    url: string;
    // Index signature keeps the payload assignable to the lib's Jsonifiable type.
    [key: string]: string;
}

export interface SendPushResult {
    sent: boolean;
    skipped?: boolean;
    /** True when the subscription is no longer valid (404/410) and should be pruned. */
    gone?: boolean;
    error?: string;
}

/**
 * Sends a single web-push message. Uses @block65/webcrypto-web-push (Web Crypto,
 * Workers-compatible) to build the encrypted, VAPID-signed request, then POSTs it
 * to the subscription endpoint. Returns gone:true for 404/410 so the caller can
 * delete the dead subscription.
 */
export async function sendPush(
    sub: StoredPushSubscription,
    payload: PushPayload,
): Promise<SendPushResult> {
    const vapid = getVapidConfig();
    if (!vapid) {
        return { sent: false, skipped: true };
    }

    try {
        const request = await buildPushPayload(
            { data: payload, options: { ttl: 60 * 60 * 24, urgency: 'normal' } },
            {
                endpoint: sub.endpoint,
                expirationTime: null,
                keys: { p256dh: sub.p256dh, auth: sub.auth },
            },
            vapid,
        );

        const res = await fetch(sub.endpoint, {
            method: request.method,
            headers: request.headers,
            body: request.body as BodyInit,
        });

        if (res.status === 404 || res.status === 410) {
            return { sent: false, gone: true };
        }
        if (!res.ok) {
            return { sent: false, error: `push ${res.status}` };
        }
        return { sent: true };
    } catch (err) {
        return { sent: false, error: err instanceof Error ? err.message : String(err) };
    }
}
