import type { APIRoute } from 'astro';
import { getVapidPublicKey } from '../../../lib/core/env';

// The client needs the VAPID public key to create a PushSubscription. It is
// public by design (only the private key is secret), so exposing it is safe.
export const GET: APIRoute = () => {
    const key = getVapidPublicKey();
    return new Response(JSON.stringify({ publicKey: key ?? null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
};
