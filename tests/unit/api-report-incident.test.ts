import { describe, it, expect, vi, beforeEach } from 'vitest';
import { en } from '../../src/lib/core/i18n/strings.en';

// vi.mock is hoisted; names starting with "mock" are hoisted alongside it.
const mockGetUser = vi.fn();
const mockAdminRpc = vi.fn();

vi.mock('../../src/lib/core/auth', () => ({
    createSupabaseAuthClient: () => ({
        auth: { getUser: mockGetUser },
    }),
}));

vi.mock('../../src/lib/core/supabase-admin', () => ({
    createSupabaseAdminClient: () => ({
        rpc: mockAdminRpc,
    }),
}));

const { POST } = await import('../../src/pages/api/orders/report-incident');

function call(body: unknown, { rawBody }: { rawBody?: string } = {}) {
    const request = new Request('https://fewya.com/api/orders/report-incident', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: rawBody ?? JSON.stringify(body),
    });
    return POST({ locals: { t: en, locale: 'en' }, request, cookies: {} } as any);
}

const validBody = {
    orderId: 'order-1',
    description: 'x'.repeat(50),
    photos: ['a.jpg', 'b.jpg', 'c.jpg'],
};

describe('POST /api/orders/report-incident', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    });

    it('returns 401 when there is no authenticated user', async () => {
        mockGetUser.mockResolvedValueOnce({ data: { user: null } });
        const res = await call(validBody);
        expect(res.status).toBe(401);
        expect(mockAdminRpc).not.toHaveBeenCalled();
    });

    it('returns 400 for an unparseable JSON body', async () => {
        const res = await call(null, { rawBody: 'not json' });
        expect(res.status).toBe(400);
    });

    it('returns 400 when required fields are missing', async () => {
        expect((await call({ description: 'x'.repeat(50), photos: [] })).status).toBe(400);
        expect((await call({ orderId: 'o', photos: [] })).status).toBe(400);
        expect((await call({ orderId: 'o', description: 'x'.repeat(50) })).status).toBe(400);
    });

    it('returns 400 when the description has fewer than 50 non-space characters', async () => {
        const res = await call({ ...validBody, description: '  ' + 'x'.repeat(49) + '  ' });
        expect(res.status).toBe(400);
        expect(mockAdminRpc).not.toHaveBeenCalled();
    });

    it('returns 400 when fewer than 3 photos are supplied', async () => {
        const res = await call({ ...validBody, photos: ['a.jpg', 'b.jpg'] });
        expect(res.status).toBe(400);
    });

    it('returns 400 when more than 20 photos are supplied', async () => {
        const res = await call({ ...validBody, photos: Array(21).fill('a.jpg') });
        expect(res.status).toBe(400);
    });

    it('calls report_order_incident with the actor id and returns 200 on success', async () => {
        mockAdminRpc.mockResolvedValueOnce({ data: [{ id: 'order-1', public_id: 'ORD-1' }], error: null });
        const res = await call(validBody);
        expect(res.status).toBe(200);
        expect(mockAdminRpc).toHaveBeenCalledWith('report_order_incident', {
            p_actor_id: 'user-1',
            p_order_id: 'order-1',
            p_description: validBody.description,
            p_photos: validBody.photos,
        });
        expect(await res.json()).toMatchObject({ success: true, orderId: 'order-1', publicId: 'ORD-1' });
    });

    it('returns 400 when the RPC reports an error', async () => {
        mockAdminRpc.mockResolvedValueOnce({ data: null, error: { message: 'invalid state transition' } });
        const res = await call(validBody);
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ error: 'invalid state transition' });
    });
});
