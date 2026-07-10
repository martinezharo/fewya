import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const getVapidConfigMock = vi.fn();
const buildPushPayloadMock = vi.fn();

vi.mock('../../src/lib/core/env', () => ({
    getVapidConfig: () => getVapidConfigMock(),
}));

vi.mock('@block65/webcrypto-web-push', () => ({
    buildPushPayload: (...args: unknown[]) => buildPushPayloadMock(...args),
}));

import { sendPush, type PushPayload } from '../../src/lib/notifications/push';
import type { StoredPushSubscription } from '../../src/lib/notifications/types';

const SUB: StoredPushSubscription = {
    id: 'sub-1',
    endpoint: 'https://push.example.com/abc',
    p256dh: 'p256dh-key',
    auth: 'auth-key',
};

const PAYLOAD: PushPayload = {
    title: 'Hola',
    body: 'Tienes una venta nueva',
    url: '/sell/orders/1',
};

const VAPID_CONFIG = {
    subject: 'mailto:test@fewya.com',
    publicKey: 'pub',
    privateKey: 'priv',
};

const BUILT_REQUEST = {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: new Uint8Array([1, 2, 3]),
};

describe('sendPush', () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
        getVapidConfigMock.mockReset();
        buildPushPayloadMock.mockReset();
        globalThis.fetch = vi.fn() as unknown as typeof fetch;
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        vi.restoreAllMocks();
    });

    it('returns skipped when VAPID is not configured, without building a payload or fetching', async () => {
        getVapidConfigMock.mockReturnValue(null);

        const result = await sendPush(SUB, PAYLOAD);

        expect(result).toEqual({ sent: false, skipped: true });
        expect(buildPushPayloadMock).not.toHaveBeenCalled();
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('builds the payload with the subscription keys and TTL/urgency options', async () => {
        getVapidConfigMock.mockReturnValue(VAPID_CONFIG);
        buildPushPayloadMock.mockResolvedValueOnce(BUILT_REQUEST);
        vi.mocked(globalThis.fetch).mockResolvedValueOnce({ ok: true, status: 201 } as unknown as Response);

        await sendPush(SUB, PAYLOAD);

        expect(buildPushPayloadMock).toHaveBeenCalledWith(
            { data: PAYLOAD, options: { ttl: 60 * 60 * 24, urgency: 'normal' } },
            { endpoint: SUB.endpoint, expirationTime: null, keys: { p256dh: SUB.p256dh, auth: SUB.auth } },
            VAPID_CONFIG,
        );
    });

    it('POSTs the built request to the subscription endpoint and returns sent:true on success', async () => {
        getVapidConfigMock.mockReturnValue(VAPID_CONFIG);
        buildPushPayloadMock.mockResolvedValueOnce(BUILT_REQUEST);
        vi.mocked(globalThis.fetch).mockResolvedValueOnce({ ok: true, status: 201 } as unknown as Response);

        const result = await sendPush(SUB, PAYLOAD);

        expect(result).toEqual({ sent: true });
        const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0];
        expect(url).toBe(SUB.endpoint);
        expect(init).toMatchObject({ method: 'POST', headers: BUILT_REQUEST.headers, body: BUILT_REQUEST.body });
    });

    it('reports gone:true for a 404 response so the caller can prune the subscription', async () => {
        getVapidConfigMock.mockReturnValue(VAPID_CONFIG);
        buildPushPayloadMock.mockResolvedValueOnce(BUILT_REQUEST);
        vi.mocked(globalThis.fetch).mockResolvedValueOnce({ ok: false, status: 404 } as unknown as Response);

        const result = await sendPush(SUB, PAYLOAD);

        expect(result).toEqual({ sent: false, gone: true });
    });

    it('reports gone:true for a 410 (Gone) response', async () => {
        getVapidConfigMock.mockReturnValue(VAPID_CONFIG);
        buildPushPayloadMock.mockResolvedValueOnce(BUILT_REQUEST);
        vi.mocked(globalThis.fetch).mockResolvedValueOnce({ ok: false, status: 410 } as unknown as Response);

        const result = await sendPush(SUB, PAYLOAD);

        expect(result).toEqual({ sent: false, gone: true });
    });

    it('returns an error for other non-ok statuses without marking the subscription gone', async () => {
        getVapidConfigMock.mockReturnValue(VAPID_CONFIG);
        buildPushPayloadMock.mockResolvedValueOnce(BUILT_REQUEST);
        vi.mocked(globalThis.fetch).mockResolvedValueOnce({ ok: false, status: 500 } as unknown as Response);

        const result = await sendPush(SUB, PAYLOAD);

        expect(result).toEqual({ sent: false, error: 'push 500' });
    });

    it('catches and reports errors thrown while building the payload', async () => {
        getVapidConfigMock.mockReturnValue(VAPID_CONFIG);
        buildPushPayloadMock.mockRejectedValueOnce(new Error('bad vapid keys'));

        const result = await sendPush(SUB, PAYLOAD);

        expect(result).toEqual({ sent: false, error: 'bad vapid keys' });
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('catches and reports errors thrown by fetch itself', async () => {
        getVapidConfigMock.mockReturnValue(VAPID_CONFIG);
        buildPushPayloadMock.mockResolvedValueOnce(BUILT_REQUEST);
        vi.mocked(globalThis.fetch).mockRejectedValueOnce(new Error('network unreachable'));

        const result = await sendPush(SUB, PAYLOAD);

        expect(result).toEqual({ sent: false, error: 'network unreachable' });
    });

    it('stringifies non-Error throwables', async () => {
        getVapidConfigMock.mockReturnValue(VAPID_CONFIG);
        buildPushPayloadMock.mockRejectedValueOnce('a plain string failure');

        const result = await sendPush(SUB, PAYLOAD);

        expect(result).toEqual({ sent: false, error: 'a plain string failure' });
    });
});
