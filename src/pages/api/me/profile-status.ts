import type { APIRoute } from 'astro';
import { api } from '../../../../convex/_generated/api';
import { createRequestConvexClient } from '../../../lib/core/auth';
import { toProfileFields } from '../../../lib/core/profile';
import { isProfileComplete } from '../../../lib/core/validation';

export const GET: APIRoute = async ({ request }) => {
    const convex = createRequestConvexClient(request);

    if (!convex) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const profile = toProfileFields(await convex.query(api.users.current, {}));
    const result = isProfileComplete(profile ?? {});

    return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
};
