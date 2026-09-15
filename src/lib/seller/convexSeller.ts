import { api } from '../../../convex/_generated/api';
import { createConvexClient } from '../core/convex';
import { createRequestConvexClient, getRequestConvexToken } from '../core/auth';

export async function getConvexSeller(request: Request): Promise<any | null> {
    const token = getRequestConvexToken(request);
    const client = token ? createConvexClient(token) : null;
    if (!client) return null;
    try {
        return await client.query(api.seller.current, {});
    } catch (error) {
        console.error('Convex seller context unavailable:', error);
        return null;
    }
}

export async function getConvexSellerProduct(request: Request, productId: string): Promise<any | null> {
    const token = getRequestConvexToken(request);
    const client = token ? createConvexClient(token) : null;
    if (!client) return null;
    try {
        return await client.query(api.seller.product, { productId });
    } catch (error) {
        console.error('Convex seller product unavailable:', error);
        return null;
    }
}

/**
 * Seller context that also answers before a shop exists.
 *
 * `getConvexSeller` runs `seller.current`, which refuses a caller who is not
 * already a seller and pulls every product, order and payment account with it.
 * Deciding where to send someone who lands on `/sell` needs neither: it only
 * asks whether there is a panel to go to, so it takes the onboarding query,
 * which is one round trip and never throws on a shopless profile.
 */
export async function getConvexSellerOnboarding(request: Request): Promise<any | null> {
    const client = createRequestConvexClient(request);
    if (!client) return null;
    try {
        return await client.query(api.seller.onboarding, {});
    } catch (error) {
        console.error('Convex seller onboarding context unavailable:', error);
        return null;
    }
}
