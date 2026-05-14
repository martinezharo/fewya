export interface CartItem {
    productId: string;
    variantId: string;
    quantity: number;
    // Denormalized data for display without API calls
    title: string;
    image: string;
    price: number;
    stock: number;
    variantName: string | null;
    shopId: string;
    shopName: string;
    shopSlug: string;
    productSlug: string;
    shippingCost: number;
}

const CART_KEY = 'fewya_cart';

function getCart(): CartItem[] {
    try {
        const raw = localStorage.getItem(CART_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
}

function saveCart(items: CartItem[]): void {
    localStorage.setItem(CART_KEY, JSON.stringify(items));
    window.dispatchEvent(new CustomEvent('cart-updated', { detail: { count: getCartCount(items) } }));
}

function getCartCount(items?: CartItem[]): number {
    const cart = items ?? getCart();
    return cart.reduce((sum, item) => sum + item.quantity, 0);
}

function addToCart(item: Omit<CartItem, 'quantity'>, quantity = 1): void {
    const cart = getCart();
    const existing = cart.find(i => i.variantId === item.variantId);
    if (existing) {
        existing.quantity += quantity;
    } else {
        cart.push({ ...item, quantity });
    }
    saveCart(cart);
}

function updateQuantity(variantId: string, quantity: number): void {
    const cart = getCart();
    const idx = cart.findIndex(i => i.variantId === variantId);
    if (idx === -1) return;
    if (quantity <= 0) {
        cart.splice(idx, 1);
    } else {
        cart[idx].quantity = quantity;
    }
    saveCart(cart);
}

function removeFromCart(variantId: string): void {
    const cart = getCart().filter(i => i.variantId !== variantId);
    saveCart(cart);
}

function clearCart(): void {
    localStorage.removeItem(CART_KEY);
    window.dispatchEvent(new CustomEvent('cart-updated', { detail: { count: 0 } }));
}

export interface CartFreshnessUpdate {
    variantId: string;
    stock: number;
    price: number;
    shippingCost: number;
    isAvailable: boolean;
}

/**
 * Apply freshness data from `/api/cart/freshness` to local cart items.
 * - Unavailable variants are removed.
 * - Stock/price/shippingCost are updated to current values.
 * - Quantities are capped to current stock.
 * Returns the list of items that were removed or had their quantity reduced.
 */
function applyFreshness(updates: CartFreshnessUpdate[]): {
    removedVariantIds: string[];
    cappedVariantIds: string[];
    repricedVariantIds: string[];
} {
    const map = new Map(updates.map((u) => [u.variantId, u]));
    const cartItems = getCart();
    const removed: string[] = [];
    const capped: string[] = [];
    const repriced: string[] = [];

    const next: CartItem[] = [];
    for (const item of cartItems) {
        const update = map.get(item.variantId);
        if (!update) {
            next.push(item);
            continue;
        }
        if (!update.isAvailable) {
            removed.push(item.variantId);
            continue;
        }
        const priceChanged = update.price !== item.price || update.shippingCost !== item.shippingCost;
        const newQuantity = Math.min(item.quantity, update.stock);
        if (newQuantity < item.quantity) capped.push(item.variantId);
        if (priceChanged) repriced.push(item.variantId);
        if (newQuantity <= 0) {
            removed.push(item.variantId);
            continue;
        }
        next.push({
            ...item,
            stock: update.stock,
            price: update.price,
            shippingCost: update.shippingCost,
            quantity: newQuantity,
        });
    }

    if (removed.length > 0 || capped.length > 0 || repriced.length > 0) {
        saveCart(next);
    }

    return {
        removedVariantIds: removed,
        cappedVariantIds: capped,
        repricedVariantIds: repriced,
    };
}

function getCartGroupedByShop(): Map<string, { shopName: string; shopSlug: string; items: CartItem[] }> {
    const cart = getCart();
    const grouped = new Map<string, { shopName: string; shopSlug: string; items: CartItem[] }>();
    for (const item of cart) {
        if (!grouped.has(item.shopId)) {
            grouped.set(item.shopId, { shopName: item.shopName, shopSlug: item.shopSlug, items: [] });
        }
        grouped.get(item.shopId)!.items.push(item);
    }
    return grouped;
}

export const cart = {
    get: getCart,
    save: saveCart,
    count: getCartCount,
    add: addToCart,
    updateQuantity,
    remove: removeFromCart,
    clear: clearCart,
    groupedByShop: getCartGroupedByShop,
    applyFreshness,
};
