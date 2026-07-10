import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const getResendApiKeyMock = vi.fn();
const getResendFromMock = vi.fn();

vi.mock('../../src/lib/core/env', () => ({
    getResendApiKey: () => getResendApiKeyMock(),
    getResendFrom: () => getResendFromMock(),
}));

import { sendEmail } from '../../src/lib/notifications/resend';

const PARAMS = {
    to: 'buyer@example.com',
    subject: 'Tu pedido ha sido enviado',
    html: '<p>Hola</p>',
};

describe('sendEmail', () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
        getResendApiKeyMock.mockReset();
        getResendFromMock.mockReset();
        getResendFromMock.mockReturnValue('Fewya <no-reply@fewya.com>');
        globalThis.fetch = vi.fn() as unknown as typeof fetch;
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        vi.restoreAllMocks();
    });

    it('returns skipped:true without calling fetch when no API key is configured', async () => {
        getResendApiKeyMock.mockReturnValue(undefined);

        const result = await sendEmail(PARAMS);

        expect(result).toEqual({ sent: false, skipped: true });
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('returns an error without calling fetch when the recipient is missing', async () => {
        getResendApiKeyMock.mockReturnValue('re_test_key');

        const result = await sendEmail({ ...PARAMS, to: '' });

        expect(result).toEqual({ sent: false, error: 'missing recipient' });
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('POSTs to the Resend API with Bearer auth and the expected body on success', async () => {
        getResendApiKeyMock.mockReturnValue('re_test_key');
        vi.mocked(globalThis.fetch).mockResolvedValueOnce({ ok: true } as unknown as Response);

        const result = await sendEmail(PARAMS);

        expect(result).toEqual({ sent: true });
        const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0];
        expect(url).toBe('https://api.resend.com/emails');
        expect(init?.method).toBe('POST');
        const headers = init?.headers as Record<string, string>;
        expect(headers.Authorization).toBe('Bearer re_test_key');
        expect(headers['Content-Type']).toBe('application/json');
        expect(JSON.parse(init?.body as string)).toEqual({
            from: 'Fewya <no-reply@fewya.com>',
            to: [PARAMS.to],
            subject: PARAMS.subject,
            html: PARAMS.html,
        });
    });

    it('returns an error including status and truncated body when Resend responds non-ok', async () => {
        getResendApiKeyMock.mockReturnValue('re_test_key');
        vi.mocked(globalThis.fetch).mockResolvedValueOnce({
            ok: false,
            status: 422,
            text: async () => 'Invalid `to` field',
        } as unknown as Response);

        const result = await sendEmail(PARAMS);

        expect(result).toEqual({ sent: false, error: 'resend 422: Invalid `to` field' });
    });

    it('truncates a very long error body to 200 characters', async () => {
        getResendApiKeyMock.mockReturnValue('re_test_key');
        const longBody = 'x'.repeat(500);
        vi.mocked(globalThis.fetch).mockResolvedValueOnce({
            ok: false,
            status: 500,
            text: async () => longBody,
        } as unknown as Response);

        const result = await sendEmail(PARAMS);

        expect(result.sent).toBe(false);
        expect(result.error).toBe(`resend 500: ${longBody.slice(0, 200)}`);
        expect(result.error?.length).toBeLessThanOrEqual('resend 500: '.length + 200);
    });

    it('falls back to an empty body string when reading the error body throws', async () => {
        getResendApiKeyMock.mockReturnValue('re_test_key');
        vi.mocked(globalThis.fetch).mockResolvedValueOnce({
            ok: false,
            status: 500,
            text: async () => {
                throw new Error('stream closed');
            },
        } as unknown as Response);

        const result = await sendEmail(PARAMS);

        expect(result).toEqual({ sent: false, error: 'resend 500: ' });
    });

    it('catches and reports errors thrown by fetch itself', async () => {
        getResendApiKeyMock.mockReturnValue('re_test_key');
        vi.mocked(globalThis.fetch).mockRejectedValueOnce(new Error('network unreachable'));

        const result = await sendEmail(PARAMS);

        expect(result).toEqual({ sent: false, error: 'network unreachable' });
    });

    it('stringifies non-Error throwables from fetch', async () => {
        getResendApiKeyMock.mockReturnValue('re_test_key');
        vi.mocked(globalThis.fetch).mockRejectedValueOnce('boom');

        const result = await sendEmail(PARAMS);

        expect(result).toEqual({ sent: false, error: 'boom' });
    });
});
