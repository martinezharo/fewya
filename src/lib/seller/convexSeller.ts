import { api } from '../../../convex/_generated/api';
import { createConvexClient } from '../core/convex';
import { getRequestConvexToken } from '../core/auth';

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
