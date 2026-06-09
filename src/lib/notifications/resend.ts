import { getResendApiKey, getResendFrom } from '../core/env';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export interface SendEmailParams {
    to: string;
    subject: string;
    html: string;
}

export interface SendEmailResult {
    sent: boolean;
    skipped?: boolean;
    error?: string;
}

/**
 * Sends a transactional email via the Resend HTTP API. Dependency-free fetch
 * call so it runs on the Cloudflare Workers runtime. Returns skipped:true when
 * no API key is configured (e.g. local dev) instead of throwing.
 */
export async function sendEmail({ to, subject, html }: SendEmailParams): Promise<SendEmailResult> {
    const apiKey = getResendApiKey();
    if (!apiKey) {
        return { sent: false, skipped: true };
    }
    if (!to) {
        return { sent: false, error: 'missing recipient' };
    }

    try {
        const res = await fetch(RESEND_ENDPOINT, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                from: getResendFrom(),
                to: [to],
                subject,
                html,
            }),
        });

        if (!res.ok) {
            const body = await res.text().catch(() => '');
            return { sent: false, error: `resend ${res.status}: ${body.slice(0, 200)}` };
        }
        return { sent: true };
    } catch (err) {
        return { sent: false, error: err instanceof Error ? err.message : String(err) };
    }
}
