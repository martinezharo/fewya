import type { APIRoute } from 'astro';
import { createRequestConvexClient } from '../../../../lib/core/auth';
import { api } from '../../../../../convex/_generated/api';
import { InvalidFieldError, optionalText } from '../../../../lib/core/requestFields';

/** Storage markers and imported URLs; long enough for either, bounded either way. */
const IMAGE_URL_MAX = 512;

export const PATCH: APIRoute = async ({ locals, request }) => {
    const { t } = locals;
    const convex = createRequestConvexClient(request);

    if (!convex) {
        return new Response(JSON.stringify({ error: t.apiUnauthorized }), { status: 401 });
    }

    let profileImg: string | null | undefined;
    let bannerImg: string | null | undefined;
    try {
        const body = await request.json();
        if (typeof body !== 'object' || body === null) throw new InvalidFieldError('body');
        const raw = body as Record<string, unknown>;
        profileImg = optionalText('profile_img', raw.profile_img, IMAGE_URL_MAX);
        bannerImg = optionalText('banner_img', raw.banner_img, IMAGE_URL_MAX);
    } catch {
        return new Response(JSON.stringify({ error: t.apiInvalidBody }), { status: 400 });
    }

    if (profileImg === undefined && bannerImg === undefined) {
        return new Response(JSON.stringify({ error: t.apiInvalidBody }), { status: 400 });
    }

    try {
        await convex.mutation(api.seller.updateShop, { profileImg, bannerImg });
        return new Response(JSON.stringify({ success: true }), { status: 200 });
    } catch (error) {
        console.error(JSON.stringify({ event: 'seller_shop_update.failed', error: error instanceof Error ? error.message : String(error) }));
        return new Response(JSON.stringify({ error: t.apiInternalError }), { status: 500 });
    }
};
